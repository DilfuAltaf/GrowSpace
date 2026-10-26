# Product Brief — GrowSpace

## 1. Product overview
**Name:** GrowSpace  
**Tagline:** Grow Smarter. Grow Naturally.  
**Category:** Smart farming and urban gardening  
**Primary format:** Responsive web application  
**Primary audience:** People managing small gardens, including beginners, students, schools, and urban growers.

GrowSpace gives users a single place to manage gardens and plants, record environmental readings, track care tasks, and understand changes over time.

## 2. Vision
Make useful farming technology approachable for people who do not have specialist agricultural knowledge or expensive monitoring equipment.

## 3. Problem statement
People growing plants in small spaces may find it difficult to keep care records, remember recurring tasks, interpret environmental measurements, and connect those measurements to practical next steps. Information may be spread across notes, spreadsheets, and unrelated apps. Some smart-farming systems also assume access to sensors or technical setup.

These are initial product hypotheses and should be validated with interviews or usability tests before being presented as universal facts.

## 4. How might we
How might we help people monitor their plants, understand garden data, and make better care decisions through an accessible digital platform that does not require IoT hardware to get started?

## 5. Proposed solution
GrowSpace combines:
1. Garden and plant management.
2. Monitoring readings with transparent source labels.
3. Historical charts.
4. Rule-based, explainable care recommendations.
5. Care schedules and completion logs.
6. A plant reference library.

The first release uses manual entries and seeded simulation. Real sensors may be integrated in a later phase.

## 6. Value proposition
**GrowSpace turns farming data into simple, actionable decisions — with or without IoT hardware.**

### Differentiators
- Hardware-optional monitoring experience.
- Source labels that distinguish simulation, manual input, and verified sensor readings.
- Plain-language recommendations with reasons and suggested checks.
- Garden, plant, monitoring, and care history in one interface.
- Nature-friendly visual design without sacrificing data readability.

Do not claim GrowSpace is the first or only product of its kind without research to support that claim.

## 7. Target users and needs
### Beginner home grower
Needs a simple way to add plants, learn basic care, and remember tasks.

### Student or school garden coordinator
Needs a clear demonstration environment, simple records, and a way to review growth activities.

### Urban gardener or hydroponic hobbyist
Needs multiple garden records, monitoring history, and easy comparison over time.

### Experienced grower
May benefit from structured logs and trends, but the MVP is not a substitute for calibrated agricultural equipment or expert diagnosis.

## 8. Jobs to be done
- When I start growing a plant, I want to record its type and planting date so that I can track it.
- When I check my garden, I want to see recent readings and their source so I can judge how much to trust them.
- When a reading needs attention, I want to understand why and what to check next.
- When I complete care, I want to log it so I can review the history.
- When I review my garden later, I want to see trends rather than isolated numbers.

## 9. Product goals
- Let a new user create a garden and add a plant without assistance.
- Make the source of every monitoring reading unambiguous.
- Connect monitoring views to relevant plant context and care actions.
- Make the main workflows usable on desktop and mobile.
- Keep each user's private records isolated.

## 10. Success measures for a competition MVP
Suggested project targets, to be adjusted after usability testing:
- A first-time tester can create a garden and plant in under 3 minutes.
- At least 4 of 5 test users can identify whether a reading is simulated or manually entered.
- At least 4 of 5 test users can find and complete a care task without help.
- No critical cross-user data access issues in authorization tests.
- No blocking layout defects at 320 px, 768 px, and 1440 px viewport widths.
- Core user flows pass the acceptance tests in `testing-qa.md`.

These are proposed targets, not measured results.

## 11. MVP boundaries
Included: authentication, garden/plant CRUD, monitoring with manual/simulated data, charts, basic recommendations, care tasks, plant library, responsive UI.

Excluded: real IoT, AI diagnosis, chatbot, social features, marketplace, payments, native mobile app.

## 12. Risks and mitigations
- **Misleading readings:** label data source and timestamp everywhere relevant.
- **Generic recommendations:** use plant-specific and method-specific reference ranges where available; otherwise display guidance to inspect rather than assert a diagnosis.
- **Scope creep:** keep the MVP focused on the main end-to-end workflow.
- **Unverified impact claims:** present recorded values as user-entered data, not independently validated outcomes.
- **Poor mobile usability:** test small screens during each phase, not only at the end.
