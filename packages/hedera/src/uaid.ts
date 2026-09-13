/**
 * HCS-14 agent identity.
 *
 * Receipts used to carry hand-written strings like `uaid:local:node-a`, which
 * look like identifiers and identify nothing: two providers could pick the
 * same one, and nobody could check either. HCS-14's `aid` method derives the
 * identifier from the agent's own metadata, so the same agent always produces
 * the same UAID and a different agent cannot collide with it by accident.
 *
 * Generated through the Hashgraph Online standards SDK rather than
 * hand-rolled, because an identifier nobody else's tooling recognises is
 * decoration.
 */
import * as standards from '@hashgraphonline/standards-sdk';

/**
 * The SDK ships HCS-14 at runtime but omits it from its published type
 * declarations (checked against 0.1.186), so the two functions used here are
 * declared locally rather than cast at every call site. Narrow on purpose: if
 * the SDK's real signature changes, this is the one place that has to move.
 */
interface Hcs14Runtime {
  createUaid(input: {
    registry: string;
    name: string;
    version: string;
    protocol: string;
    nativeId: string;
    skills: number[];
  }): Promise<string>;
}

const hcs14 = standards as unknown as Hcs14Runtime;
const { createUaid } = hcs14;

/**
 * HCS-14's two methods: a derived `aid`, or a wrapped `did`. Parameters follow
 * after a semicolon.
 *
 * Structural only. The SDK's `validateUaid` resolves against a registry broker
 * over the network, which is a different question — whether an id is
 * well-formed should not need a server, and a receipt validator must not make
 * a network call.
 */
const UAID_SHAPE = /^uaid:(aid|did):[A-Za-z0-9._:%-]+(;[A-Za-z0-9._=:%-]+)*$/;

export interface AgentIdentity {
  /** Stable name for this agent within the registry, e.g. a provider id. */
  name: string;
  /** The Hedera account this agent transacts as. */
  accountId: string;
  network?: 'testnet' | 'mainnet';
  version?: string;
}

/** The registry name every Tessera agent is minted under. */
export const UAID_REGISTRY = 'tessera';
/** The protocol these agents speak — BSP, this repo's settlement protocol. */
export const UAID_PROTOCOL = 'bsp';

function nativeIdFor(accountId: string, network: 'testnet' | 'mainnet'): string {
  return `hedera:${network}:${accountId}`;
}

async function mint(agent: AgentIdentity, role: 'provider' | 'renter'): Promise<string> {
  const network = agent.network ?? 'testnet';
  return createUaid({
    registry: UAID_REGISTRY,
    // Role is part of the derived identity: the same account acting as
    // provider and as renter is two agents, and should not share one id.
    name: `${role}:${agent.name}`,
    version: agent.version ?? '0.1.0',
    protocol: UAID_PROTOCOL,
    nativeId: nativeIdFor(agent.accountId, network),
    skills: [],
  });
}

/** The UAID a provider daemon signs its receipts with. */
export function providerUaid(agent: AgentIdentity): Promise<string> {
  return mint(agent, 'provider');
}

/** The UAID a renter is recorded under on the receipts it pays for. */
export function renterUaid(agent: AgentIdentity): Promise<string> {
  return mint(agent, 'renter');
}

/** True when `value` is a structurally well-formed HCS-14 UAID. */
export function isUaid(value: string): boolean {
  return UAID_SHAPE.test(value);
}
