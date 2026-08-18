// Etapa 3 do Contrato Técnico. Esta é a versão mock: compara a descrição
// contra o ncm_catalog local usando correspondência de texto simples, só
// pra fechar o pipeline ponta a ponta. O contrato da função é o que importa
// aqui — quando a busca semântica de verdade entrar, ela troca a implementação
// mas mantém a mesma assinatura e o mesmo formato de saída.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CandidatoNCM } from "../types.ts";

export const EMBEDDING_MODELO_ATUAL = "mock-text-match-v0";
const LIMIAR_MINIMO_SIMILARIDADE = 0.15;
const MAX_CANDIDATOS = 8;

export interface FindCandidatesResult {
  candidatos: CandidatoNCM[];
  base_ncm_indisponivel: boolean;
  nenhum_candidato_acima_limiar: boolean;
}

export async function findNcmCandidates(
  supabase: SupabaseClient,
  descricaoNormalizada: string,
): Promise<FindCandidatesResult> {
  const termos = descricaoNormalizada.split(" ").filter((t) => t.length > 2);
  if (termos.length === 0) {
    return { candidatos: [], base_ncm_indisponivel: false, nenhum_candidato_acima_limiar: true };
  }

  // Mock: usa um "or" de ilike sobre a descrição oficial. Isso NÃO é busca
  // semântica — é o placeholder mínimo pra ter algum sinal real vindo do banco
  // até o embedding entrar.
  const orFiltro = termos.slice(0, 5).map((t) => `descricao_oficial.ilike.%${t}%`).join(",");

  const { data, error } = await supabase
    .from("ncm_catalog")
    .select("ncm, descricao_oficial")
    .or(orFiltro)
    .limit(50);

  if (error) {
    return { candidatos: [], base_ncm_indisponivel: true, nenhum_candidato_acima_limiar: false };
  }

  const candidatos: CandidatoNCM[] = (data ?? [])
    .map((row) => {
      const descOficialNorm = (row.descricao_oficial ?? "").toLowerCase();
      const acertos = termos.filter((t) => descOficialNorm.includes(t)).length;
      const score = acertos / termos.length;
      return { ncm: row.ncm, descricao_oficial: row.descricao_oficial, score };
    })
    .filter((c) => c.score >= LIMIAR_MINIMO_SIMILARIDADE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATOS);

  return {
    candidatos,
    base_ncm_indisponivel: false,
    nenhum_candidato_acima_limiar: candidatos.length === 0,
  };
}
