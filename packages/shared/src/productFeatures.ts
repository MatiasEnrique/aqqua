/**
 * Remote environment and network-exposure flows are implemented but are not
 * ready to be exposed as product UI yet. Keep this gate shared by every client
 * so one surface cannot accidentally ship an entry point before the others.
 */
export const REMOTE_CONNECTIONS_UI_ENABLED = false;
