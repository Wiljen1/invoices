import crypto from "node:crypto";
import type { NetSuiteAuthMode, ServerConfig } from "../env";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface OAuthToken {
  accessToken: string;
  expiresAt: number;
}

interface SuiteQlResponse<T> {
  items?: T[];
}

export class NetSuiteRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
  }
}

export class NetSuiteClient {
  private readonly accountId: string;
  private readonly realm: string;
  private readonly restBaseUrl: string;
  private readonly authMode: NetSuiteAuthMode;
  private readonly oauth2: ServerConfig["netsuite"]["oauth2"];
  private readonly tba: ServerConfig["netsuite"]["tba"];
  private cachedOAuthToken?: OAuthToken;

  constructor(config: ServerConfig["netsuite"]) {
    this.accountId = config.accountId;
    this.realm = config.realm || config.accountId;
    this.restBaseUrl = config.restBaseUrl.replace(/\/$/, "");
    this.authMode = config.authMode;
    this.oauth2 = config.oauth2;
    this.tba = config.tba;
  }

  async suiteql<T>(query: string) {
    const response = await this.request<SuiteQlResponse<T>>("POST", "/services/rest/query/v1/suiteql", {
      q: query
    });
    return response.items ?? [];
  }

  private async request<T>(method: HttpMethod, path: string, body?: unknown) {
    this.assertConfigured();
    const url = new URL(path, this.restBaseUrl).toString();
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: await this.authorizationHeader(method, url),
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: "transient"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text().then(extractNetSuiteErrorDetail).catch(() => "");
      throw new NetSuiteRequestError(
        [
          `NetSuite request failed with status ${response.status}.`,
          detail,
          "Check role permissions for REST Web Services, SuiteQL, customers, invoices, and sales orders."
        ]
          .filter(Boolean)
          .join(" "),
        response.status
      );
    }

    return (await response.json()) as T;
  }

  private assertConfigured() {
    if (!this.accountId || !this.restBaseUrl) {
      throw new NetSuiteRequestError("NetSuite account ID and REST base URL are required.");
    }

    if (this.authMode === "oauth2") {
      const hasBearer = Boolean(this.oauth2.accessToken);
      const hasClientCredentials = Boolean(this.oauth2.clientId && this.oauth2.clientSecret);
      const hasClientAssertion = Boolean(this.oauth2.clientId && this.oauth2.clientAssertion);
      if (!hasBearer && !hasClientCredentials && !hasClientAssertion) {
        throw new NetSuiteRequestError(
          "OAuth 2.0 credentials are missing. Add an access token, client credentials, or a client assertion."
        );
      }
    }

    if (this.authMode === "tba") {
      const complete = this.tba.consumerKey && this.tba.consumerSecret && this.tba.tokenId && this.tba.tokenSecret;
      if (!complete) {
        throw new NetSuiteRequestError("Token-Based Authentication credentials are incomplete.");
      }
    }
  }

  private async authorizationHeader(method: HttpMethod, url: string) {
    if (this.authMode === "tba") {
      return this.tbaAuthorizationHeader(method, url);
    }

    return `Bearer ${await this.oauthAccessToken()}`;
  }

  private async oauthAccessToken() {
    if (this.oauth2.accessToken) return this.oauth2.accessToken;
    if (this.cachedOAuthToken && Date.now() < this.cachedOAuthToken.expiresAt) {
      return this.cachedOAuthToken.accessToken;
    }

    const tokenUrl =
      this.oauth2.tokenUrl ||
      `${this.restBaseUrl}/services/rest/auth/oauth2/v1/token`;

    const body = new URLSearchParams({ grant_type: this.oauth2.grantType || "client_credentials" });
    if (this.oauth2.scope) body.set("scope", this.oauth2.scope);
    if (this.oauth2.clientId) body.set("client_id", this.oauth2.clientId);
    if (this.oauth2.clientAssertion) {
      body.set("client_assertion", this.oauth2.clientAssertion);
      body.set(
        "client_assertion_type",
        this.oauth2.clientAssertionType || "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    };
    if (!this.oauth2.clientAssertion && this.oauth2.clientId && this.oauth2.clientSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${this.oauth2.clientId}:${this.oauth2.clientSecret}`).toString("base64")}`;
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers,
      body
    });

    if (!response.ok) {
      throw new NetSuiteRequestError(`Unable to obtain NetSuite OAuth token. Status ${response.status}.`, response.status);
    }

    const payload = (await response.json()) as { access_token: string; expires_in?: number };
    this.cachedOAuthToken = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(30, (payload.expires_in ?? 3600) - 60) * 1000
    };
    return this.cachedOAuthToken.accessToken;
  }

  private tbaAuthorizationHeader(method: HttpMethod, url: string) {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.tba.consumerKey!,
      oauth_nonce: crypto.randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: this.tba.tokenId!,
      oauth_version: "1.0"
    };

    const parsedUrl = new URL(url);
    const signingParams = new URLSearchParams(parsedUrl.search);
    Object.entries(oauthParams).forEach(([key, value]) => signingParams.set(key, value));

    const encodedParams = [...signingParams.entries()]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
      )
      .map(([key, value]) => `${encodeOAuth(key)}=${encodeOAuth(value)}`)
      .join("&");

    const baseUrl = `${parsedUrl.origin}${parsedUrl.pathname}`;
    const signatureBase = [method.toUpperCase(), encodeOAuth(baseUrl), encodeOAuth(encodedParams)].join("&");
    const signingKey = `${encodeOAuth(this.tba.consumerSecret!)}&${encodeOAuth(this.tba.tokenSecret!)}`;
    const signature = crypto.createHmac("sha256", signingKey).update(signatureBase).digest("base64");

    return [
      `OAuth realm="${encodeOAuth(this.realm)}"`,
      ...Object.entries({ ...oauthParams, oauth_signature: signature }).map(
        ([key, value]) => `${encodeOAuth(key)}="${encodeOAuth(value)}"`
      )
    ].join(", ");
  }
}

function encodeOAuth(value: string) {
  return encodeURIComponent(value)
    .replaceAll("!", "%21")
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
}

function extractNetSuiteErrorDetail(body: string) {
  if (!body) return "";

  try {
    const parsed = JSON.parse(body) as {
      "o:errorDetails"?: Array<{ detail?: string; "o:errorCode"?: string }>;
      title?: string;
    };
    const firstDetail = parsed["o:errorDetails"]?.[0];
    return firstDetail?.detail || firstDetail?.["o:errorCode"] || parsed.title || "";
  } catch {
    return body.slice(0, 300);
  }
}
