export {};

declare global {
  interface Window {
    arweaveWallet: {
      connect(
        permissions: ArConnectPermission[],
        appInfo?: { name: string; logo?: string }
      ): Promise<void>;
      disconnect(): Promise<void>;
      getActiveAddress(): Promise<string>;
      getPermissions(): Promise<ArConnectPermission[]>;
      encrypt(
        data: ArrayBuffer | ArrayBufferView,
        algorithm: { name: string; [key: string]: unknown }
      ): Promise<Uint8Array>;
      decrypt(
        data: ArrayBuffer | ArrayBufferView,
        algorithm: { name: string; [key: string]: unknown }
      ): Promise<ArrayBuffer>;
      getActivePublicKey(): Promise<string>;
      sign(transaction: ArweaveTransaction): Promise<ArweaveTransaction>;
      // Signs arbitrary bytes with RSA-PSS (used by @irys/sdk ArconnectSigner).
      // Requires the SIGNATURE permission.
      signature(
        data: Uint8Array,
        algorithm: { name: string; saltLength?: number }
      ): Promise<Uint8Array>;
      // Signs AND submits a transaction atomically. For quantity>0 transfers
      // this is always a BASE (L1) transaction. Requires DISPATCH permission.
      dispatch(
        transaction: ArweaveTransaction
      ): Promise<{ id: string; type: "BASE" | "BUNDLE" }>;
      // Signs an ANS-104 data item and returns the fully signed binary blob.
      // Shows a human-readable popup with tags (document name, type, etc.)
      // instead of raw bytes. Preferred over signature() for bundle uploads.
      // Requires SIGN_DATA_ITEM permission.
      signDataItem(item: {
        data: string | Uint8Array;
        target?: string;
        anchor?: string;
        tags?: { name: string; value: string }[];
      }): Promise<ArrayBuffer>;
    };
  }

  type ArConnectPermission =
    | "ACCESS_ADDRESS"
    | "ACCESS_PUBLIC_KEY"
    | "ACCESS_ALL_ADDRESSES"
    | "SIGN_TRANSACTION"
    | "ENCRYPT"
    | "DECRYPT"
    | "SIGNATURE"
    | "ACCESS_ARWEAVE_CONFIG"
    | "DISPATCH";

  interface ArweaveTransaction {
    id?: string;
    format?: number;
    last_tx?: string;
    owner?: string;
    tags?: { name: string; value: string }[];
    target?: string;
    quantity?: string;
    data?: string;
    reward?: string;
    signature?: string;
    data_size?: string;
    data_root?: string;
  }
}
