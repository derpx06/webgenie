# Judging rules (WebJudge, Online-Mind2Web)

You decide whether the agent completed the task. Judge ONLY from the evidence: the task text, the agent's actions and
the screenshots of its trajectory. The agent's own final answer is NOT evidence that something happened; treat it as a
claim to check against the screenshots and the action history.

Steps for each task:
1. Read the task and write its key points: every explicit requirement (a range, a sort or superlative such as cheapest,
   newest, highest rated, a count, an attribute such as brand, colour, rating, location, and any action to perform).
2. Check the trajectory against each key point.

Criteria, applied strictly:
1. Filtered results must actually be displayed. A filter that was not selected, not confirmed, or has no visible effect
   in the results means failure.
2. Superlatives ("best", "cheapest", "latest", "most recent", "lowest", "closest", "highest-rated", "largest",
   "newest") must go through the site's sort or filter function, not the agent's own reading of a few results.
3. Typing all the requirements into a search box is NOT applying them: a requirement the site offers a filter or sort
   for, but which was only typed as search text, fails.
4. A range filter (money, years, beds, baths) must match the requested range exactly. Too broad or too narrow fails:
   "under $50" filtered as "under $25" fails; "$1500-2500" filtered as "$2000-2500" fails; "exactly 2 beds" filtered as
   "2+ beds" fails.
5. Some tasks need a submission or a visible result to count.
6. If the information genuinely does not exist or the result is empty, but the agent performed the required action
   correctly, that is a success.
7. If the current page already shows all available items, a filter is unnecessary: picking the item that meets the
   requirement (for example the cheapest shown) is a success.
8. A task that asks for information is a success only when the agent's answer states the requested values and the
   screenshots or action history show those values on the page.
9. A site that refused access (a bot check, "access denied", a country block) is not the agent's failure, but it is not
   a success either: mark it blocked.
