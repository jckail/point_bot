import { toProviderDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { ListProviders } from "@pointup/core/provider-catalog";

/** Public: the provider catalog is not user-specific. */
export function GET() {
  const providers = new ListProviders().execute();
  return NextResponse.json(providers.map(toProviderDto));
}
