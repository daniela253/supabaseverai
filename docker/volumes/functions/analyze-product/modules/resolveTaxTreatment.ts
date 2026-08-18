// Etapa 6 do Contrato Técnico. Consulta a Base Tributária real (tax_rules /
// tax_rule_versions), já em produção. Busca a regra publicada e vigente na
// data_referencia_tributaria — não a vigente hoje. Sem regra, não presume
// tratamento: registra a ausência via base_tributaria_ausente.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TaxResult } from "../types.ts";

export interface ResolveTaxResult {
  tax: TaxResult | null;
  base_tributaria_ausente: boolean;
}

export async function resolveTaxTreatment(
  supabase: SupabaseClient,
  ncm: string | null,
  dataReferencia: string,
): Promise<ResolveTaxResult> {
  if (!ncm) {
    return { tax: null, base_tributaria_ausente: true };
  }

  // Regra: maior prefixo de ncm_prefix que bate com o NCM, publicada, e cuja
  // vigência cobre a data de referência (vigencia_inicio <= data e
  // (vigencia_fim is null ou vigencia_fim >= data)).
  const { data: rules, error: rulesError } = await supabase
    .from("tax_rules")
    .select("id, ncm_prefix");

  if (rulesError) return { tax: null, base_tributaria_ausente: true };

  const candidatas = (rules ?? []).filter((r) => ncm.startsWith(r.ncm_prefix));
  if (candidatas.length === 0) return { tax: null, base_tributaria_ausente: true };

  const maisEspecifica = candidatas.sort((a, b) => b.ncm_prefix.length - a.ncm_prefix.length)[0];

  const { data: versao, error: versaoError } = await supabase
    .from("tax_rule_versions")
    .select("*")
    .eq("rule_id", maisEspecifica.id)
    .eq("status", "publicada")
    .lte("vigencia_inicio", dataReferencia)
    .or(`vigencia_fim.is.null,vigencia_fim.gte.${dataReferencia}`)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versaoError || !versao) {
    return { tax: null, base_tributaria_ausente: true };
  }

  return {
    tax: {
      rule_version_id: versao.id,
      cst_ibs_cbs: versao.cst,
      cclasstrib: versao.cclass,
      percentual_reducao: versao.p_red_ibs,
      fundamento_legal: versao.fundamento_legal,
      anexo: versao.anexo,
      fonte: versao.fonte,
      evidencias: [{
        fonte: versao.fonte ?? "Base Tributária Vera",
        dispositivo: versao.fundamento_legal ?? "",
        trecho_relevante: `Regra vigente desde ${versao.vigencia_inicio}, versão ${versao.version}.`,
        url_referencia: null,
        data_consulta: new Date().toISOString().slice(0, 10),
      }],
    },
    base_tributaria_ausente: false,
  };
}
