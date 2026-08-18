// Etapa 2 do Contrato Técnico. Regras determinísticas, sem chamada externa.
import type { ProductInput, ProductNormalized } from "../types.ts";

const LIMIAR_MIN_CARACTERES = 6; // abaixo disso, não há sinal suficiente pra seguir

function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Hash simples e estável, usado só para idempotência (não é criptográfico).
async function hashInput(payload: string): Promise<string> {
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface NormalizeResult {
  produto: ProductNormalized;
  descricao_insuficiente: boolean;
}

export async function normalizeProduct(
  input: ProductInput,
  contextoOrganizacao: string,
): Promise<NormalizeResult> {
  const descricaoNormalizada = normalizarTexto(input.descricao || "");
  const descricaoInsuficiente = descricaoNormalizada.length < LIMIAR_MIN_CARACTERES;

  const dataReferencia =
    input.data_referencia_tributaria ??
    (input.dados_xml?.data_emissao as string | undefined) ??
    new Date().toISOString().slice(0, 10);

  // input_hash cobre os campos que definem "é o mesmo item" para fins de
  // idempotência: descrição, NCM informado, código interno e o contexto
  // (organização), como definido no Contrato Técnico.
  const chaveHash = JSON.stringify({
    org: contextoOrganizacao,
    descricao: input.descricao,
    ncm_informado: input.ncm_informado ?? null,
    codigo_interno: input.codigo_interno ?? null,
  });

  const produto: ProductNormalized = {
    ...input,
    data_referencia_tributaria: dataReferencia,
    descricao_normalizada: descricaoNormalizada,
    input_hash: await hashInput(chaveHash),
  };

  return { produto, descricao_insuficiente: descricaoInsuficiente };
}
