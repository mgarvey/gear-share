# Gear contents and handoff checks

Status: Future product idea. This note is not an approved implementation scope.

## Member value

- Let an owner or authorized gear manager add an optional, ordered list of what belongs with an item, such as a tent body, rain fly, poles, and stakes.
- Show expected component quantities and short handling notes on the item detail page.
- When gear with a contents list is checked out, record what was actually handed over.
- At return, record what came back and distinguish something already missing at checkout from something lost or damaged during the loan.
- Keep the handoff and return record with the loan even if the item contents are edited later.
- Do not require these extra steps for ordinary items that have no contents list.

## Product decisions still needed

- Confirm editing authority under the current Regular member, Gear custodian, and Administrator roles.
- Decide whether a contents discrepancy should automatically place the item in **Needs Attention** or simply offer that action to the authorized manager.
- Decide how much contents information belongs on catalog cards versus the item detail page.
- Validate the checkout and return interaction with both Administrators and Regular members before fixing the data model.

## Initial boundaries

- No serial-number tracking for individual components.
- No repair-ticket system, fees, deposits, signatures, or inspection photos.
- No AI-generated contents lists in the initial version.
- A discrepancy should not prevent a valid return from completing.

Any future proposal should be written against the current `supabase/` schema,
current role names, current loan workflow, and canonical specifications.
