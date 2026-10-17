"""asterisk ships a desktop half and a dashboard API, and registers its auxiliary task (its model row in Settings → Models); it adds no agent-side hooks."""

DESCRIPTION = "Rereads the turn of a long reply and names what the reply did not plainly say. Checks nothing until you choose a model here; it does not follow the main model on its own."


def register(ctx) -> None:
    ctx.register_auxiliary_task("asterisk", display_name="Asterisk", description=DESCRIPTION)
