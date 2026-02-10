import Client from "ssh2-sftp-client";

export { default as SftpClient } from "ssh2-sftp-client";
export type { ConnectOptions as SftpConnectOptions } from "ssh2-sftp-client";

/**
 * Pre-instantiated SFTP client singleton.
 * @deprecated Prefer creating your own SftpClient instance for better lifecycle control.
 */
export const SftpService = new Client();
