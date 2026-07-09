import { toPublicPortfolioSnapshotDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { DomainError } from "@pointup/core";
import { httpStatusForErrorCode } from "@pointup/core/contracts";

type Context = { params: Promise<{ token: string }> };

/** Public (unauthenticated) privacy-preserving portfolio snapshot. */
export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  try {
    const snapshot =
      await getContainer().useCases.getPublicPortfolioSnapshot.execute(token);
    return NextResponse.json(toPublicPortfolioSnapshotDto(snapshot));
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: httpStatusForErrorCode(error.code) },
      );
    }
    throw error;
  }
}
