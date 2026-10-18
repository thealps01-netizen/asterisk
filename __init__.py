"""asterisk ships a desktop half and a dashboard API, and registers its auxiliary task (its model row in Settings → Models); it adds no agent-side hooks."""

DESCRIPTION = "Rereads a turn where the assistant used a tool that can change something, or wrote a long reply (3,000+ characters), with your earlier messages as context, and names what the reply did not plainly say: a tradeoff, a doubtful result, an assumption, an irreversible step, a security risk, a cost, a request left unanswered, work claimed but not done, something you ruled out or did not ask for. About 75 checks per active day on one user's history (~$4), against 14 before. Checks nothing until you choose a model here; it does not follow the main model on its own."


def register(ctx) -> None:
    ctx.register_auxiliary_task("asterisk", display_name="Asterisk", description=DESCRIPTION)
