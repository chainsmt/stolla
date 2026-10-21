# CommunityTimelock

`CommunityTimelock` holds an approved call batch for one community until the
ADR-006 delay has elapsed, then executes that exact batch or lets it expire.
The contract follows
[ADR-006](../../../docs/adr/006-timelock-treasury-execution.md) for queue,
execute, and cancel. It does not implement treasury spend limits, and it does
not change the signaling `CommunityGovernor` used by current testnet deploys.

`CommunityGovernor` still uses the OpenZeppelin default
`proposals_need_queuing() == false`. Successful signaling proposals on those
deploys can still execute through the Governor itself. This contract is an
additional per-community gate for a future Governor that opts in by calling
`queue`. Deploying it does not rewrite existing Governor WASM, storage, or
voting parameters.

## Constructor authorization

```text
__constructor(admin, governor, guardian)
```

| Argument | Role |
| --- | --- |
| `admin` | Must authorize the deployment transaction. The address is checked with `require_auth` and is **not** written to storage. |
| `governor` | The only address allowed to authorize `queue`. Stored for the life of the contract. |
| `guardian` | The only address allowed to authorize `cancel`. Stored for the life of the contract. |

`bootstrap_active()` reads the flag set at construction and returns `false`.
There is no later call that restores the admin. ADR-006 requires bootstrap
authority to disappear in the same activation that names the Governor and
Guardian. This constructor is that activation: the admin signs once, and the
contract keeps only the two operational addresses.

The admin should be the deployment multisig described in ADR-006. This crate
does not keep a setter that the admin could use afterward. Rotating Governor
or Guardian is a later timelocked governance action and is not implemented
here.

## Governor wiring

Point `governor` at the community's `CommunityGovernor` contract address when
that Governor is ready to queue. Do not redeploy or upgrade the signaling
Governors already on testnet as part of this contract.

The intended call, from a future Governor release, after it has decided the
proposal is succeeded:

```text
CommunityTimelock.queue(
  targets,
  functions,
  args,
  description_hash,
  operator = governor_contract_address
)
```

`queue` requires `operator == governor` and `operator.require_auth()`. A
transaction sender cannot satisfy that check by naming the Governor address.
The Governor contract has to authorize the call itself, which in practice
means the Governor's own code invokes `queue`.

Before storing the batch, this contract also calls
`Governor.proposal_state(proposal_id)` and accepts only `Succeeded` (value 4
in `stellar-governance` 0.7.2). The proposal id is the existing Governor id
from `stellar_governance::governor::hash_proposal`: keccak256 over the XDR of
`targets`, `functions`, `args`, and `description_hash`. That is the id
`CommunityGovernor` already computes. A batch that does not correspond to a
succeeded proposal on the configured Governor is rejected.

Until a Governor release makes that call, nothing in the current signaling
Governor path reaches this contract. Voters, thresholds, quorum, and immediate
signaling execution stay as they are.

## Delay, expiry, and status

Ledger sequence numbers are the clock. Wall-clock estimates assume a
five-second close and are not enforced.

| Parameter | Value | Meaning |
| --- | ---: | --- |
| `MIN_DELAY_LEDGERS` | 34,560 | Earliest execution is `queued_at + delay` |
| `GRACE_LEDGERS` | 120,960 | Last executable ledger is `earliest + grace` |
| `MAX_BATCH_CALLS` | 10 | Longer batches are rejected |

If queueing succeeds in ledger `Q`:

```text
earliest = Q + 34,560
expiry   = earliest + 120,960
executable when earliest <= now <= expiry
expired when now > expiry
```

Checked addition rejects a queue that would overflow `u32`. Cancellation and
expiry do not rewrite `queued_at`, `earliest_ledger`, or `expiry_ledger`.

Each action stores:

- the Governor proposal id
- `sha256` of the XDR of the target, function, and argument vectors
- those vectors and the description hash, so execute can reject a mismatch
- earliest and expiry ledgers
- a terminal status: `Queued`, `Executing`, `Executed`, `Cancelled`, or `Expired`

The action id is:

```text
sha256(XDR(
  "stolla.timelock.v1",
  this_timelock,
  governor,
  proposal_id,
  targets,
  functions,
  args
))
```

The preimage is one Soroban struct, not concatenated strings. Records are
persistent and are not deleted when they become terminal, so the same
proposal cannot be queued again for a fresh delay. A new vote with a new
proposal id is required. Instance and action entries extend their TTL by the
same 30-day amount used by `CommunityGovernor`.

`execute` moves the record to `Executing` before the calls and to `Executed`
after all of them return. A reverted Soroban transaction rolls `Executing`
back to `Queued`, so a failed target can be retried with the same bytes while
the window is open. A second successful execute is rejected.

`execute` at `earliest - 1` fails. `execute` at `earliest` and at `expiry`
succeeds. `execute` at `expiry + 1` fails even if nobody has called
`mark_expired`. `mark_expired` is permissionless after that boundary and only
records the terminal status.

## Cancel

`cancel(action_id, reason_hash, operator)` requires
`operator == guardian` and `require_auth`. The Guardian address is expected
to be a multisig contract. This crate checks that one address. It does not
implement a 2-of-3 threshold; the account at `guardian` does.

Cancellation is allowed only while the action is still `Queued` and the
current ledger is not past expiry. It stores the reason hash, emits
`action_cancelled`, and leaves the record in place. The Guardian cannot
queue, execute, or shorten the delay through this contract.

## Public reads

| Function | Purpose |
| --- | --- |
| `governor()` / `guardian()` | Wired addresses |
| `bootstrap_active()` | Whether bootstrap authority remains (`false` after construction) |
| `min_delay()` / `grace_ledgers()` | ADR-006 constants |
| `get_action(action_id)` | Batch hash, calldata, timing, and status |
| `action_id(...)` / `batch_hash(...)` | Recompute the ids the contract stores |
| `extend_instance_ttl()` | Permissionless instance renewal |

## Assumptions outside this crate

- Treasury asset caps, recipient allowlists, and other spend policy are a
  separate issue. `execute` invokes the queued calls in order and does not
  decode payments.
- Emergency pause, contract upgrades, and rolling spend windows from ADR-006
  are not in this surface.
- The current signaling Governor is left unchanged on purpose. Wiring it to
  require queueing would change testnet execution and is explicitly out of
  scope.
- `proposal_state` must be the OpenZeppelin Governor method. Unit tests use a
  stub that returns that integer. A Governor that does not expose it cannot
  queue.

## Tests

From `contracts/`:

```sh
cargo test -p community-timelock
```

The suite covers constructor authorization and Governor wiring, the happy
path at the earliest ledger, execution one ledger early, the inclusive expiry
ledger, execution after expiry, replay, a mismatched batch, an unauthorized
queue, a proposal that is not `Succeeded`, empty and uneven batches, delay
overflow, and Guardian versus stranger cancellation.
