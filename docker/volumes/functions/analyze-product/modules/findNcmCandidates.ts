// Etapa 3 do Contrato Técnico.
// MOCK TEMPORÁRIO: busca textual enriquecida no ncm_catalog.
// Será substituído pela busca semântica/embeddings mantendo o mesmo contrato.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { CandidatoNCM } from "../types.ts";

export const EMBEDDING_MODELO_ATUAL = "mock-text-match-v1";

const LIMIAR_MINIMO_SIMILARIDADE = 0.15;
const MAX_CANDIDATOS = 8;

export interface FindCandidatesResult {
  candidatos: CandidatoNCM[];
  base_ncm_indisponivel: boolean;
  nenhum_candidato_acima_limiar: boolean;
}

// Palavras que normalmente não ajudam a identificar a classificação fiscal
const STOPWORDS = new Set([
  "para",
  "com",
  "sem",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "um",
  "uma",
  "e",
  "ou",
  "tipo",
  "marca",
  "unidade",
  "un",
  "und",
  "ml",
  "kg",
  "g",
]);

// Ponte temporária entre linguagem comercial e terminologia oficial.
// Isso NÃO substitui embeddings.
const SINONIMOS: Record<string, string[]> = {
  shampoo: ["xampu", "xampus"],
  shampoos: ["xampu", "xampus"],
  xampu: ["xampus", "shampoo"],
  xampus: ["xampu", "shampoo"],

  celular: ["telefone", "telefones"],
  smartphone: ["telefone", "telefones"],

  remedio: ["medicamento", "medicamentos"],
  remédio: ["medicamento", "medicamentos"],

  notebook: ["computador", "computadores"],
  laptop: ["computador", "computadores"],
};

function normalizarTexto(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extrairTermos(descricao: string): string[] {
  const normalizada = normalizarTexto(descricao);

  const termosBase = normalizada
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3)
    .filter((t) => !STOPWORDS.has(t))
    // remove quantidade embutida, ex. 300ml
    .filter((t) => !/^\d+(ml|kg|g|l|un|und)?$/.test(t));

  const expandidos: string[] = [];

  for (const termo of termosBase) {
    expandidos.push(termo);

    const sinonimos = SINONIMOS[termo] || [];
    expandidos.push(...sinonimos);
  }

  return [...new Set(expandidos)];
}

export async function findNcmCandidates(
  supabase: SupabaseClient,
  descricaoNormalizada: string,
): Promise<FindCandidatesResult> {

  const termos = extrairTermos(descricaoNormalizada);

  if (termos.length === 0) {
    return {
      candidatos: [],
      base_ncm_indisponivel: false,
      nenhum_candidato_acima_limiar: true,
    };
  }

  // Usa até 10 termos/variações para não gerar uma query excessivamente grande.
  const termosBusca = termos.slice(0, 10);

  const orFiltro = termosBusca
    .map((t) => `descricao_oficial.ilike.%${t}%`)
    .join(",");

  const { data, error } = await supabase
    .from("ncm_catalog")
    .select("ncm, descricao_oficial")
    .or(orFiltro)
    .limit(100);

  if (error) {
    console.error("Erro consultando ncm_catalog:", error);

    return {
      candidatos: [],
      base_ncm_indisponivel: true,
      nenhum_candidato_acima_limiar: false,
    };
  }

  const candidatos: CandidatoNCM[] = (data ?? [])
    .map((row) => {
      const descricaoOficial = normalizarTexto(
        row.descricao_oficial ?? ""
      );

      const termosQueBateram = termosBusca.filter((termo) =>
        descricaoOficial.includes(normalizarTexto(termo))
      );

      // O denominador limitado evita punir demais descrições comerciais
      // naturalmente mais longas.
      const denominador = Math.max(
        1,
        Math.min(termosBusca.length, 4)
      );

      const score = Math.min(
        1,
        termosQueBateram.length / denominador
      );

      return {
        ncm: row.ncm,
        descricao_oficial: row.descricao_oficial,
        score,
      };
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
