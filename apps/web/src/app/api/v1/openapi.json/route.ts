import { buildOpenApiDocument } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

/**
 * Public OpenAPI 3.1 document for the v1 API, generated from the zod contracts.
 * Lets third parties integrate (or generate clients) without the TS package.
 */
export function GET() {
  return NextResponse.json(buildOpenApiDocument());
}
