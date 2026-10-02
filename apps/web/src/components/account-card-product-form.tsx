"use client";

import type { LoyaltyAccountReadModel } from "@pointup/core";
import { CARD_PRODUCTS } from "@pointup/core/card-products";
import { useActionState } from "react";
import { updateCardProductAction } from "@/app/actions";
import { FormFeedback, SubmitButton } from "@/components/form-feedback";
import { idleActionResult } from "@/lib/action-result";

export function AccountCardProductForm({ account }: { account: LoyaltyAccountReadModel }) {
  const [result, formAction] = useActionState(updateCardProductAction, idleActionResult);
  const products = CARD_PRODUCTS.filter(product => product.providerId === account.provider.id);
  if (products.length === 0) return null;
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="accountId" value={account.id} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-muted">
        Card used for transfers
        <select name="cardProductId" defaultValue={account.cardProductId ?? ""} className="rounded-xl border border-line bg-midnight px-3 py-2.5 text-ink outline-none focus:border-brand">
          <option value="">Unknown / clear selection</option>
          {products.map(product => <option key={product.id} value={product.id}>{product.displayName}</option>)}
        </select>
      </label>
      <p className="text-xs text-ink-faint">If you have multiple Chase cards, select the card you will transfer from. Selection does not verify ownership. Unknown or unverified card rules exclude that route from advice; check your issuer terms before transferring.</p>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save transfer card</SubmitButton>
        <FormFeedback result={result} successMessage="Transfer card saved. Advice updated." />
      </div>
    </form>
  );
}
