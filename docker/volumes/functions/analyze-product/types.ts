// Vera 2.0 — tipos do motor. Espelham direto a Especificação Funcional
// (blocos 1.1 a 1.8) e o Contrato Técnico do Motor. Nenhum campo aqui deveria
// divergir do que está nos dois documentos — se divergir, o documento é que
// está certo, e este arquivo precisa ser corrigido.

export type SourceType = "MANUAL" | "LOTE" | "XML";

// ---- payload de ENTRADA da Edge Function ----
export interface AnalyzeRequest {
  organization_id: string;
  source_type: SourceType;
  source_reference?: string | null;
  items: ProductInput[];
}

export interface ProductInput {
  descricao: string;
  codigo_interno?: string | null;
  ncm_informado?: string | null;
  dados_xml?: Record<string, unknown> | null;
  // XML → data de emissão da nota; manual → informada pelo usuário ou data atual.
  data_referencia_tributaria?: string | null; // ISO date
}

// ---- estruturas internas do pipeline ----
export interface ProductNormalized extends ProductInput {
  descricao_normalizada: string;
  input_hash: string;
}

export interface CandidatoNCM {
  ncm: string;
  descricao_oficial: string;
  score: number; // pontuação bruta de similaridade, etapa 3
  motivo_reordenamento?: string; // preenchido na etapa 4
}

export interface ReasoningOutput {
  candidato_preferido: string | null;
  justificativa: string;
  evidencias_adicionais: ClassificationEvidence[];
  ambiguidade_residual: number; // 0 a 1
}

export interface ClassificationEvidence {
  tipo: string;
  origem: string;
  trecho: string;
  peso: number;
  referencia?: string | null;
}

export interface ClassificationResult {
  ncm_sugerido: string | null;
  score_classificacao: number | null;
  nivel_confianca: "ALTA" | "MEDIA" | "BAIXA" | null;
  candidato_preferido: string | null;
  justificativa: string | null;
  ambiguidade_residual: number | null;
  alternativas: CandidatoNCM[];
  evidencias: ClassificationEvidence[];
  classificador_versao: string;
  embedding_modelo: string;
  modelo_raciocinio: string;
}

export interface TaxEvidence {
  fonte: string;
  dispositivo: string;
  trecho_relevante: string;
  url_referencia?: string | null;
  data_consulta: string;
}

export interface TaxResult {
  rule_version_id: string | null;
  cst_ibs_cbs: string | null;
  cclasstrib: string | null;
  percentual_reducao: number | null;
  fundamento_legal: string | null;
  anexo: string | null;
  fonte: string | null;
  evidencias: TaxEvidence[];
}

export type FindingTipo =
  | "NCM_INCORRETA"
  | "CST_INCOMPATIVEL"
  | "CCLASSTRIB_INCOMPATIVEL"
  | "REDUCAO_NAO_APLICADA"
  | "BENEFICIO_SEM_FUNDAMENTO"
  | "CEST_AUSENTE"
  | "CEST_FORMATO_INVALIDO"
  | "CFOP_AUSENTE"
  | "CFOP_INCONSISTENCIA_INTERNA";

export type Severidade = "nenhuma" | "baixa" | "media" | "alta" | "critica";

export interface AuditFinding {
  tipo: FindingTipo;
  severidade: Severidade;
  motivo: string;
  acao_sugerida: string;
}

export interface ImpactEstimate {
  valor_operacao: number | null;
  impacto_potencial_estimado: number | null;
  nivel_confianca_impacto: "ALTA" | "MEDIA" | "BAIXA" | null;
  premissas_calculo: Record<string, unknown>;
  requer_revisao_profissional: boolean;
}

// As seis causas distintas de SEM_BASE, seção "execution_flags" do Contrato Técnico.
export interface ExecutionFlags {
  descricao_insuficiente?: boolean;
  base_ncm_indisponivel?: boolean;
  nenhum_candidato_acima_limiar?: boolean;
  base_tributaria_ausente?: boolean;
  modelo_raciocinio_indisponivel?: boolean;
  dados_xml_insuficientes?: boolean;
}

export type StatusGeral = "VALIDADO" | "REVISAR" | "DIVERGENCIA" | "SEM_BASE";

// O AnalysisResult completo de um item — o que persistAnalysisResult() grava.
export interface AnalysisResult {
  item_id: string;
  status_geral: StatusGeral;
  execution_flags: ExecutionFlags;
  classification: ClassificationResult | null;
  tax: TaxResult | null;
  findings: AuditFinding[];
  impact: ImpactEstimate | null;
}

// ---- payload de SAÍDA da Edge Function ----
export interface AnalyzeResponse {
  job_id: string;
  analysis_id: string;
  status: "concluido" | "falhou" | "parcial";
  itens: Array<{
    item_id: string;
    input_hash: string;
    status_geral: StatusGeral;
    reused: boolean; // true quando o item já existia (idempotência) e não foi reprocessado
  }>;
  erros: Array<{ index: number; mensagem: string }>;
}
