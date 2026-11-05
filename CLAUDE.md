# Lotus on-site time tracking: project rules

Its own project, separate from Atlas/Twilight.

- Product truth lives in PRODUCT.md, and the visual system in DESIGN.md.
- Follow ux-behavior-spec.md for all motion, hover/press, sync/status feedback, notifications, reduced motion and responsive behavior, without being asked. If a request conflicts with it, say so before deviating.
- Hours worked (labelled "Hours worked", formerly "delivered") merge everyone's time per robot per day: never double-count a pair. Keep "Hours worked" and "Operator hours" labelled distinctly everywhere; never use "hours worked" for one operator's own time.
- The people on site are "Operators", never "workers".
- Check-in time is the server's (Power Automate `utcNow()`), never the device clock. Operators can't enter a clock-in time.
- Raw clock-ins are never approved hours. Only approved operator-days reach the approved-hours export; keep raw exports and the approved export separate and labelled.
- The flows enforce roles; hiding a screen is never the only protection. Operators only ever see their own rows; the one exception is the names of the operators sharing their shift (same robot, same shift), never their times or hours. No rates, pay or markups anywhere.
- The live data contract is docs/lotus-flows.md. Change it together with src/lib/api.js.
- Demo data is synthetic and must stay labelled as demo.
- Bump `VERSION` in src/version.js (major.minor.MMDDYY plus a letter per release that day, as in Atlas) with every merge to main.
