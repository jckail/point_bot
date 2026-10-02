import { toProviderDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";

/** Public: the provider catalog is not user-specific. */
export async function GET() {
  // `tracedAll` makes every `execute` async, so this must be awaited.
  const providers = await getContainer().useCases.listProviders.execute();
  return NextResponse.json(providers.map(toProviderDto));
}
