# Queueing messages

While an agent turn is running, the composer offers three actions:

- **Queue** saves the message for the next turn. aqqua submits the first queued message
  automatically when the current turn finishes, then continues through the queue one turn at a
  time.
- **Steer** submits the message to the running turn immediately. Pressing Enter keeps this
  existing steering behavior.
- **Stop** interrupts the running turn. If messages are queued, the first one starts afterward.

Queued messages appear above the composer. Remove a queued message with its close button before it
is submitted.

The queue is part of the environment's durable thread state, so it survives reconnects and is
visible to connected web and desktop clients. Each queued message keeps the model, runtime mode,
interaction mode, and attachments selected when it was queued.
