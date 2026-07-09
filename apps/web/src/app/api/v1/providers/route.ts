import { toProviderDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";

/** Public: the provider catalog is not user-specific. */
export function GET() {
  const providers = getContainer().useCases.listProviders.execute();
  return NextResponse.json(providers.map(toProviderDto));
}
