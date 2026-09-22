// The retry prompt used to repeat only the validator's error text. These two mistakes are
// the ones models make most often, and the plain text does not say how to fix them, so the
// second attempt tended to repeat them and the run fell back to "insufficient evidence".
export function correctionHints(errors, snapshot) {
  const hints = [];
  let unknownFieldsHinted = false;
  for (const error of errors) {
    if (error === 'suggested_weights must be numeric percentages totaling 100') {
      hints.push('suggested_weights: deesc + base + stag must equal exactly 100 (whole numbers). Add them up before answering; if you are not changing the weights, copy the snapshot weights exactly.');
    } else if (error === 'DCA amount exceeds current installment limit') {
      const limit = snapshot?.dca?.current_installment_limit_egp;
      hints.push(`reads.dca: do not write or mention the total plan budget or any other currency amount. The only amount you may state is current_installment_limit_egp (${limit ?? 0} EGP) or less; otherwise describe the installment by its percentage or tranche number.`);
    } else if (error.endsWith(': unknown fields')) {
      if (!unknownFieldsHinted) {
        unknownFieldsHinted = true;
        hints.push('Use only the fields in the output example, nothing extra: every weight_changes item has exactly scenario, from, to and evidence_ids (no reason or note), and no other top-level field such as search_performed.');
      }
    } else if (error.startsWith('no_material_change ')) {
      hints.push('status: use no_material_change only if the previous analysis was recent, made the same decision, and its suggested weights equal the current snapshot weights (the previous suggestion may not have been applied). If they differ, use material_change and keep suggested_weights equal to the snapshot weights.');
    }
  }
  return hints;
}
