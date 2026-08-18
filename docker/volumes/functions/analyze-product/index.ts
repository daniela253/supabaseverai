// Vera 2.0 — Edge Function analyze-product
//
// Orquestra o pipeline de nove etapas do Contrato Técnico do Motor.
// Cada módulo tem uma responsabilidade e é testável isoladamente:
//
//   normalizeProduct()
//   findNcmCandidates()
//   rankCandidates()
//   reasonAboutCandidates()
//   calculateClassificationScore()   [5b — agregação determinística]
//   resolveTaxTreatment()
//   auditProduct()
//   estimateImpact()
//   persistAnalysisResult()
//
// Estratégia de erro/retry:
//   - Falha numa etapa de UM item nunca derruba os outros itens do lote.
//   - Toda causa de degradação vira uma execution_flag, nunca uma exceção
//     silenciosa nem um resultado inventado.
//   - input_hash garante idempotência: reenviar o mesmo item não duplica —
//     devolve o item já existente, marcado como reused.
//   - analysis_jobs.status só vira "concluido" se todos os itens
//     processaram (com ou sem flags); vira "falhou" só se a etapa de
//     persistência do job/analysis em si falhar, antes de chegar aos itens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AnalyzeRequest, AnalyzeResponse, ExecutionFlags, StatusGeral } from "./types.ts";
import { normalizeProduct } from "./modules/normalizeProduct.ts";
import { findNcmCandidates } from "./modules/findNcmCandidates.ts";
import { rankCandidates } from "./modules/rankCandidates.ts";
import { reasonAboutCandidates } from "./modules/reasonAboutCandidates.ts";
import { calculateClassificationScore } from "./modules/calculateClassificationScore.ts";
import { resolveTaxTreatment } from "./modules/resolveTaxTreatment.ts";
import { auditProduct } from "./modules/auditProduct.ts";
import { estimateImpact } from "./modules/estimateImpact.ts";
import { persistAnalysisResult } from "./modules/persistAnalysisResult.ts";

function computeStatusGeral(
  flags: ExecutionFlags,
  findings: { severidade: string }[],
  nivelConfianca: string | null
): StatusGeral {

  // SEM_BASE só quando a própria classificação não conseguiu avançar.
  if (
    flags.descricao_insuficiente ||
    flags.base_ncm_indisponivel ||
    flags.nenhum_candidato_acima_limiar
  ) {
    return "SEM_BASE";
  }

  // Divergências relevantes têm prioridade sobre revisão.
  if (
    findings.some(
      (f) =>
        f.severidade?.toLowerCase() === "alta" ||
        f.severidade?.toLowerCase() === "critica"
    )
  ) {
    return "DIVERGENCIA";
  }

  // A classificação existe, mas alguma parte complementar
  // não pôde ser concluída com segurança.
  if (
    nivelConfianca === "BAIXA" ||
    flags.base_tributaria_ausente ||
    flags.modelo_raciocinio_indisponivel ||
    flags.dados_xml_insuficientes
  ) {
    return "REVISAR";
  }

  return "VALIDADO";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erro: "use POST" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service role: a função grava em nome do usuário autenticado, já validado pelo gateway
  );

  let body: AnalyzeRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ erro: "corpo da requisição não é um JSON válido" }), { status: 400 });
  }

  if (!body.organization_id || !body.items?.length) {
    return new Response(JSON.stringify({ erro: "organization_id e items são obrigatórios" }), { status: 400 });
  }

  // ---- cria o job e a análise (cabeçalho da execução) ----
  const { data: job, error: jobError } = await supabase
    .from("analysis_jobs")
    .insert({
      organization_id: body.organization_id,
      source_type: body.source_type,
      source_reference: body.source_reference ?? null,
      status: "processando",
      total_itens: body.items.length,
      iniciado_em: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return new Response(JSON.stringify({ erro: `falha ao criar analysis_job: ${jobError?.message}` }), { status: 500 });
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .insert({ job_id: job.id, organization_id: body.organization_id, total_itens: body.items.length })
    .select("id")
    .single();

  if (analysisError || !analysis) {
    await supabase.from("analysis_jobs").update({ status: "falhou" }).eq("id", job.id);
    return new Response(JSON.stringify({ erro: `falha ao criar analysis: ${analysisError?.message}` }), { status: 500 });
  }

  const resultado: AnalyzeResponse = {
    job_id: job.id,
    analysis_id: analysis.id,
    status: "concluido",
    itens: [],
    erros: [],
  };

  let itensConcluidos = 0;

  // ---- processa cada item; falha de um item não derruba os demais ----
  for (let index = 0; index < body.items.length; index++) {
    try {
      const { produto, descricao_insuficiente } = await normalizeProduct(body.items[index], body.organization_id);

      // idempotência: já existe um item com esse hash nesta análise?
      const { data: existente } = await supabase
        .from("analysis_items")
        .select("id, status_geral")
        .eq("analysis_id", analysis.id)
        .eq("input_hash", produto.input_hash)
        .maybeSingle();

      if (existente) {
        resultado.itens.push({
          item_id: existente.id,
          input_hash: produto.input_hash,
          status_geral: existente.status_geral,
          reused: true,
        });
        itensConcluidos++;
        continue;
      }

      const flags: ExecutionFlags = { descricao_insuficiente };

      let classification = null;
      let tax = null;
      let findings: Awaited<ReturnType<typeof auditProduct>> = [];
      let impact = null;

      if (!descricao_insuficiente) {
        const busca = await findNcmCandidates(supabase, produto.descricao_normalizada);
        flags.base_ncm_indisponivel = busca.base_ncm_indisponivel;
        flags.nenhum_candidato_acima_limiar = busca.nenhum_candidato_acima_limiar;

        if (busca.candidatos.length > 0) {
          const ranked = rankCandidates(produto, busca.candidatos);
          const reasoning = await reasonAboutCandidates(produto, ranked.candidatos, ranked.ambiguo);
          flags.modelo_raciocinio_indisponivel = reasoning.modelo_raciocinio_indisponivel;

          classification = calculateClassificationScore(ranked.candidatos, reasoning.resultado);

          const ncmParaTributar = classification.ncm_sugerido ?? produto.ncm_informado ?? null;
          const taxResolved = await resolveTaxTreatment(supabase, ncmParaTributar, produto.data_referencia_tributaria!);
          tax = taxResolved.tax;
          flags.base_tributaria_ausente = taxResolved.base_tributaria_ausente;

          findings = auditProduct(produto, classification, tax);
          impact = estimateImpact(produto, findings, tax);
          if (impact && impact.impacto_potencial_estimado === null && findings.length > 0) {
            flags.dados_xml_insuficientes = true;
          }
        }
      }

      const statusGeral = computeStatusGeral(flags, findings, classification?.nivel_confianca ?? null);

      const { item_id } = await persistAnalysisResult(supabase, {
        analysisId: analysis.id,
        organizationId: body.organization_id,
        produto,
        executionFlags: flags,
        statusGeral,
        classification,
        tax,
        findings,
        impact,
      });

      resultado.itens.push({ item_id, input_hash: produto.input_hash, status_geral: statusGeral, reused: false });
      itensConcluidos++;
    } catch (err) {
      resultado.erros.push({ index, mensagem: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- fecha o job ----
  const statusFinal = resultado.erros.length === 0
    ? "concluido"
    : itensConcluidos > 0
    ? "parcial"
    : "falhou";
  resultado.status = statusFinal as AnalyzeResponse["status"];

  await supabase
    .from("analysis_jobs")
    .update({
      status: statusFinal === "parcial" ? "concluido" : statusFinal, // "parcial" é status de resposta, não de job
      itens_concluidos: itensConcluidos,
      concluido_em: new Date().toISOString(),
    })
    .eq("id", job.id);

  return new Response(JSON.stringify(resultado), {
    status: resultado.erros.length && itensConcluidos === 0 ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});
