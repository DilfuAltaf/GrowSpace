import Groq from 'groq-sdk';
import type { AnalyticsSummaryResponse } from '@growspace/shared';
import { getGroqApiKey, getGroqModel } from '../env';

let groqExplainOverride: ((summary: AnalyticsSummaryResponse) => Promise<string>) | null = null;

export function setGroqExplainOverride(
  override: ((summary: AnalyticsSummaryResponse) => Promise<string>) | null,
): void {
  groqExplainOverride = override;
}

const EXPLAIN_SYSTEM_PROMPT = `You are an expert, conservative agricultural and smart farming advisor for GrowSpace.
Your job is to provide a concise, readable, and practical 2-3 paragraph explanation of computed farm analytics for the user.

CRITICAL GROUNDING RULES:
1. ONLY discuss facts, metrics, and alerts present in the provided JSON data.
2. NEVER invent, fabricate, or extrapolate sensor readings, dates, percentages, or conditions that are not explicitly provided.
3. NEVER override or contradict deterministic plant condition states (optimal, low, high, stale_data, insufficient_data, unconfigured_range).
4. NEVER diagnose plant diseases, fungal infections, or recommend extreme chemical or drastic interventions without direct physical evidence.
5. If prior period comparison is marked as unavailable or hasComparableData is false, clearly state that earlier historical data is not yet available for trend comparison.
6. Emphasize observation provenance when relevant (e.g., distinguishing simulated demo data or manual logs from physical sensors).
7. Keep tone clear, professional, supportive, and actionable for farmers and gardeners.
8. Output plain text paragraphs only. Do NOT output markdown code blocks or JSON.`;

export async function explainAnalytics(summary: AnalyticsSummaryResponse): Promise<string> {
  if (groqExplainOverride) {
    return groqExplainOverride(summary);
  }

  const apiKey = getGroqApiKey();
  if (!apiKey) {
    return summary.deterministicSummary;
  }

  try {
    const groq = new Groq({ apiKey, timeout: 15000 });
    const model = getGroqModel();

    // Prepare non-sensitive, aggregated summary facts
    const factsPayload = {
      period: summary.period,
      hasPriorComparison: summary.previousPeriod.hasComparableData,
      environmentalStats: Object.entries(summary.stats).map(([type, s]) => ({
        measurement: type,
        readingCount: s.count,
        unit: s.unit,
        average: s.avg,
        range: s.min != null && s.max != null ? { min: s.min, max: s.max } : null,
        changeVsPriorPeriod: s.deltaAvg,
        sources: s.sourceBreakdown,
      })),
      conditionAlerts: summary.plantInsights
        .filter((i) => i.state !== 'optimal')
        .map((i) => ({
          plant: i.plantName,
          metric: i.measurementType,
          state: i.state,
          observed: i.observedValue,
          targetRange: i.referenceRange,
          severity: i.severity,
          reason: i.reason,
        })),
      optimalCount: summary.plantInsights.filter((i) => i.state === 'optimal').length,
      tasks: summary.taskSummary,
      recentLogsRecorded: summary.recentLogs.length,
      deterministicSummaryText: summary.deterministicSummary,
    };

    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.2, // Conservative, low creativity
      max_tokens: 600,
      messages: [
        { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Here are the verified farm monitoring metrics and care tasks for the current period:\n${JSON.stringify(factsPayload, null, 2)}\n\nPlease provide an explainable farming assessment grounded strictly in these figures.`,
        },
      ],
    });

    const output = completion.choices[0]?.message?.content?.trim();
    if (!output) {
      return summary.deterministicSummary;
    }

    return output;
  } catch (err) {
    // If Groq fails (e.g. rate limit, network timeout, model error), gracefully fall back
    console.warn('[AnalyticsGroq] Failed to explain analytics with Groq, falling back to deterministic summary:', err);
    return summary.deterministicSummary;
  }
}
