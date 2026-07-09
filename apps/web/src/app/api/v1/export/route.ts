import {
  exportQuerySchema,
  toPortfolioExportCsv,
  toPortfolioExportDto,
} from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Portable dump of the signed-in user's accounts + balance history. */
export function GET(request: Request) {
  return withAuthenticatedUser(async (userId) => {
    const { format = "json" } = exportQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );

    const exported =
      await getContainer().useCases.exportPortfolio.execute(userId);

    if (format === "csv") {
      const stamp = exported.exportedAt.toISOString().slice(0, 10);
      return new NextResponse(toPortfolioExportCsv(exported), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="pointup-export-${stamp}.csv"`,
        },
      });
    }

    return NextResponse.json(toPortfolioExportDto(exported));
  });
}
