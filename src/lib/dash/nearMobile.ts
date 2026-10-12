import { NEAR_MOBILE_API, NEAR_MOBILE_LINK } from "./constants";

export interface NearAction {
  type: "FunctionCall";
  params: {
    methodName: string;
    args: Record<string, unknown>;
    gas: string;
    deposit: string;
  };
}

interface SignerRequest {
  id: string;
  status: "pending" | "approved" | "rejected";
  signerAccountId?: string;
  txHash?: string[];
  response?: { accountId?: string; publicKey?: string } | null;
}

const META = {
  name: "T-800 Trader",
  url: "https://machine10101-vibes.github.io/t800-trader/",
  logoUrl: "https://machine10101-vibes.github.io/t800-trader/logos/tokens/dash.png",
};

let frame: HTMLIFrameElement | null = null;

function widgetFrame(): HTMLIFrameElement {
  if (frame && document.body.contains(frame)) return frame;
  const next = document.createElement("iframe");
  next.title = "NEAR Mobile";
  next.src = NEAR_MOBILE_API;
  next.style.border = "none";
  next.style.position = "fixed";
  next.style.inset = "0";
  next.style.width = "100%";
  next.style.height = "100%";
  next.style.zIndex = "10000";
  next.style.display = "none";
  next.style.background = "transparent";
  document.body.appendChild(next);
  frame = next;
  return next;
}

function showRequest(id: string, kind: "request" | "message"): void {
  const node = widgetFrame();
  node.style.display = "block";
  const requestUrl = `${NEAR_MOBILE_LINK}/${kind}/${id}`;
  const send = () => {
    node.contentWindow?.postMessage({ requestUrl, isNearMobile: false }, NEAR_MOBILE_API);
  };
  if (node.dataset.ready === "1") send();
  else node.addEventListener("load", () => {
    node.dataset.ready = "1";
    send();
  }, { once: true });
}

function hideRequest(): void {
  if (frame) frame.style.display = "none";
}

async function signerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${NEAR_MOBILE_API}${path}`, {
    ...init,
    headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => null)) as T & { message?: string } | null;
  if (!res.ok || !json) {
    const message = json && typeof json.message === "string" ? json.message : "NEAR Mobile did not answer.";
    throw new Error(message);
  }
  return json;
}

async function waitFor(path: string): Promise<SignerRequest> {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const row = await signerFetch<SignerRequest>(path);
    if (row.status === "approved") return row;
    if (row.status === "rejected") throw new Error("NEAR Mobile rejected the request.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("NEAR Mobile did not answer in time.");
}

/** Ask NEAR Mobile to approve this browser. Returns the NEAR account id. */
export async function connectNearMobile(): Promise<string> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)));
  const created = await signerFetch<SignerRequest>("/api/signer-request/message", {
    method: "POST",
    body: JSON.stringify({
      network: "mainnet",
      message: "Connect the T-800 Dash desk",
      receiver: "t800-trader.near",
      nonce,
      receiverMetadata: META,
    }),
  });
  showRequest(created.id, "message");
  try {
    const done = await waitFor(`/api/signer-request/message/${created.id}`);
    const account = done.response?.accountId || done.signerAccountId || "";
    if (!account.includes(".")) throw new Error("NEAR Mobile connected but did not return an account.");
    return account;
  } finally {
    hideRequest();
  }
}

/** NEAR Mobile signs the token transfer into the NEAR DEX deposit account. */
export async function signNearTransfer(input: {
  signerId: string;
  token: string;
  receiverId: string;
  amount: string;
  memo?: string | null;
}): Promise<string> {
  const action: NearAction = {
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer",
      args: {
        receiver_id: input.receiverId,
        amount: input.amount,
        memo: input.memo ?? null,
      },
      gas: "30000000000000",
      deposit: "1",
    },
  };
  const created = await signerFetch<SignerRequest>("/api/signer-request", {
    method: "POST",
    body: JSON.stringify({
      network: "mainnet",
      transactions: [{ signerId: input.signerId, receiverId: input.token, actions: [action] }],
      dAppMetadata: META,
    }),
  });
  showRequest(created.id, "request");
  try {
    const done = await waitFor(`/api/signer-request/${created.id}`);
    const hash = done.txHash?.[0] ?? "";
    if (!hash) throw new Error("NEAR Mobile approved the swap but did not return a transaction.");
    return hash;
  } finally {
    hideRequest();
  }
}
