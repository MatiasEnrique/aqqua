# Queueing messages

While an agent turn is running, submitting from the composer queues the message for the next turn.
aqqua submits the first queued message automatically when the current turn finishes, then
continues through the queue one turn at a time.

Each queued message has a steer action that submits it to the running turn immediately. When more
than one message is queued, **Send all** submits them as one message, joined in queue order with a
newline. **Stop** interrupts the running turn; if messages remain queued, the first one starts
afterward.

Queued messages appear above the composer. Remove a queued message with its close button before it
is submitted, or use its steer action to send it early.

The queue is part of the environment's durable thread state, so it survives reconnects and is
visible to connected web, desktop, and mobile clients. Mobile keeps an offline outbox and hands
queued messages to the environment when it reconnects. Each queued message keeps the model,
runtime mode, interaction mode, and attachments selected when it was queued.

Queue behavior is enabled only when the connected environment advertises queue support. The steer
and **Send all** controls require the environment's separate queue-steering capability, so newer
clients do not send those commands to older queue-capable servers. Normal submit continues to
steer when a client connects to a server without queue support.
