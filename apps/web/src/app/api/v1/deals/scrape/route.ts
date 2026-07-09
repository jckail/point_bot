import {
  scrapeDealRequestSchema,
  toIngestDealPageResultDto,
  toValueAdviceDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/**
 * Scrape a deal / award-chart URL (Firecrawl or stub) and re-rank value advice
 * with the extracted candidates included.
 */
export function POST(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const body = scrapeDealRequestSchema.parse(await request.json());
    const { useCases } = getContainer();
    const ingested = await useCases.ingestDealPage.execute({
      url: body.url,
      providerId: body.providerId,
    });
    const advice = await useCases.getValueAdvice.execute(
      userId,
      ingested.deals,
    );
    return NextResponse.json(
      {
        ingest: toIngestDealPageResultDto(ingested),
        advice: toValueAdviceDto(advice),
      },
      { status: 201 },
    );
  });
}
