import { toAgentSkillDto } from "@pointup/core/contracts";
import { NextResponse } from "next/server";

import { getContainer } from "@/server/container";
import { withAuthenticatedUser } from "@/server/http";

/** Skill catalog annotated with the caller's link + consent state. */
export function GET(request: Request) {
  return withAuthenticatedUser(
    async (userId) => {
      const providerId =
        new URL(request.url).searchParams.get("providerId") ?? undefined;
      const skills = await getContainer().useCases.listAgentSkills.execute(
        userId,
        { providerId },
      );
      return NextResponse.json(skills.map(toAgentSkillDto));
    },
    { scope: "portfolio:read" },
  );
}
