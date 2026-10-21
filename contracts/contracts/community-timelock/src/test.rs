#![cfg(test)]

extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    vec, Address, BytesN, ConversionError, Env, Error, IntoVal, InvokeError, String, Symbol, Val,
    Vec,
};
use stellar_governance::governor::hash_proposal;

use crate::{
    ActionStatus, CommunityTimelock, CommunityTimelockClient, TimelockError, GRACE_LEDGERS,
    MIN_DELAY_LEDGERS,
};

/// `ProposalState::Succeeded` in stellar-governance 0.7.2.
const PROPOSAL_SUCCEEDED: u32 = 4;

#[contract]
struct MockGovernor;

#[contractimpl]
impl MockGovernor {
    pub fn __constructor(e: &Env, state: u32) {
        e.storage().instance().set(&Symbol::new(e, "state"), &state);
    }

    pub fn proposal_state(e: &Env, _proposal_id: BytesN<32>) -> u32 {
        e.storage()
            .instance()
            .get(&Symbol::new(e, "state"))
            .unwrap()
    }

    pub fn set_state(e: &Env, state: u32) {
        e.storage().instance().set(&Symbol::new(e, "state"), &state);
    }
}

#[contract]
struct ExecutionTarget;

#[contractimpl]
impl ExecutionTarget {
    pub fn apply(e: &Env, value: u32) {
        let value_key = Symbol::new(e, "value");
        let calls_key = Symbol::new(e, "calls");
        let calls: u32 = e.storage().instance().get(&calls_key).unwrap_or(0);
        e.storage().instance().set(&value_key, &value);
        e.storage().instance().set(&calls_key, &(calls + 1));
    }

    pub fn value(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&Symbol::new(e, "value"))
            .unwrap_or(0)
    }

    pub fn calls(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&Symbol::new(e, "calls"))
            .unwrap_or(0)
    }
}

struct Batch {
    target_id: Address,
    targets: Vec<Address>,
    functions: Vec<Symbol>,
    args: Vec<Vec<Val>>,
    description_hash: BytesN<32>,
}

struct Fixture {
    e: Env,
    admin: Address,
    governor_id: Address,
    guardian: Address,
    timelock_id: Address,
}

impl Fixture {
    fn new() -> Self {
        let e = Env::default();
        e.mock_all_auths();
        e.ledger().with_mut(|ledger| {
            ledger.sequence_number = 1_000;
        });
        let admin = Address::generate(&e);
        let guardian = Address::generate(&e);
        let governor_id = e.register(MockGovernor, (PROPOSAL_SUCCEEDED,));
        let timelock_id = e.register(
            CommunityTimelock,
            (admin.clone(), governor_id.clone(), guardian.clone()),
        );
        Self {
            e,
            admin,
            governor_id,
            guardian,
            timelock_id,
        }
    }

    fn client(&self) -> CommunityTimelockClient<'_> {
        CommunityTimelockClient::new(&self.e, &self.timelock_id)
    }

    fn governor(&self) -> MockGovernorClient<'_> {
        MockGovernorClient::new(&self.e, &self.governor_id)
    }

    fn set_ledger(&self, sequence: u32) {
        self.e.ledger().with_mut(|ledger| {
            ledger.sequence_number = sequence;
        });
    }

    fn batch(&self, value: u32) -> Batch {
        let target_id = self.e.register(ExecutionTarget, ());
        let description = String::from_str(&self.e, "Set the execution fixture value");
        let description_hash = self
            .e
            .crypto()
            .keccak256(&description.to_bytes())
            .to_bytes();
        Batch {
            target_id: target_id.clone(),
            targets: vec![&self.e, target_id],
            functions: vec![&self.e, Symbol::new(&self.e, "apply")],
            args: vec![&self.e, vec![&self.e, value.into_val(&self.e)]],
            description_hash,
        }
    }
}

fn failed<T>(
    error: TimelockError,
) -> Result<Result<T, ConversionError>, Result<Error, InvokeError>> {
    Err(Ok(error.into()))
}

fn target_client<'a>(e: &'a Env, target_id: &Address) -> ExecutionTargetClient<'a> {
    ExecutionTargetClient::new(e, target_id)
}

fn queue_batch(fixture: &Fixture, batch: &Batch) -> BytesN<32> {
    fixture.client().queue(
        &batch.targets,
        &batch.functions,
        &batch.args,
        &batch.description_hash,
        &fixture.governor_id,
    )
}

#[test]
fn constructor_keeps_governor_wiring_and_drops_bootstrap_admin() {
    let fixture = Fixture::new();
    let client = fixture.client();

    assert_eq!(client.governor(), fixture.governor_id);
    assert_eq!(client.guardian(), fixture.guardian);
    assert!(!client.bootstrap_active());
    assert_eq!(client.min_delay(), MIN_DELAY_LEDGERS);
    assert_eq!(client.grace_ledgers(), GRACE_LEDGERS);
    let _admin = fixture.admin;
}

#[test]
fn constructor_requires_admin_authorization() {
    let e = Env::default();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        e.register(
            CommunityTimelock,
            (
                Address::generate(&e),
                Address::generate(&e),
                Address::generate(&e),
            ),
        );
    }));
    assert!(result.is_err());
}

#[test]
fn queue_and_execute_at_earliest_ledger() {
    let fixture = Fixture::new();
    let batch = fixture.batch(23);
    let target = target_client(&fixture.e, &batch.target_id);
    let queued_at = fixture.e.ledger().sequence();

    let action_id = queue_batch(&fixture, &batch);
    let record = fixture.client().get_action(&action_id).unwrap();
    let earliest = queued_at + MIN_DELAY_LEDGERS;
    let expiry = earliest + GRACE_LEDGERS;

    assert_eq!(record.status, ActionStatus::Queued);
    assert_eq!(record.queued_at, queued_at);
    assert_eq!(record.earliest_ledger, earliest);
    assert_eq!(record.expiry_ledger, expiry);
    assert_eq!(
        record.batch_hash,
        fixture
            .client()
            .batch_hash(&batch.targets, &batch.functions, &batch.args)
    );
    assert_eq!(
        record.proposal_id,
        hash_proposal(
            &fixture.e,
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash
        )
    );
    assert_eq!(target.value(), 0);

    let executor = Address::generate(&fixture.e);
    fixture.set_ledger(earliest);
    assert_eq!(
        fixture.client().execute(
            &action_id,
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &executor,
        ),
        action_id
    );

    assert_eq!(target.value(), 23);
    assert_eq!(target.calls(), 1);
    assert_eq!(
        fixture.client().get_action(&action_id).unwrap().status,
        ActionStatus::Executed
    );
}

#[test]
fn execute_one_ledger_before_earliest_is_rejected() {
    let fixture = Fixture::new();
    let batch = fixture.batch(7);
    let target = target_client(&fixture.e, &batch.target_id);
    let action_id = queue_batch(&fixture, &batch);
    let earliest = fixture
        .client()
        .get_action(&action_id)
        .unwrap()
        .earliest_ledger;
    let executor = Address::generate(&fixture.e);

    fixture.set_ledger(earliest - 1);
    assert_eq!(
        fixture.client().try_execute(
            &action_id,
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &executor,
        ),
        failed(TimelockError::TooEarly)
    );
    assert_eq!(target.value(), 0);
    assert_eq!(target.calls(), 0);
    assert_eq!(
        fixture.client().get_action(&action_id).unwrap().status,
        ActionStatus::Queued
    );
}

#[test]
fn execute_after_expiry_is_rejected_and_can_be_marked() {
    let fixture = Fixture::new();
    let batch = fixture.batch(11);
    let target = target_client(&fixture.e, &batch.target_id);
    let action_id = queue_batch(&fixture, &batch);
    let record = fixture.client().get_action(&action_id).unwrap();
    let executor = Address::generate(&fixture.e);

    fixture.set_ledger(record.expiry_ledger);
    assert_eq!(
        fixture.client().execute(
            &action_id,
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &executor,
        ),
        action_id
    );
    assert_eq!(target.value(), 11);

    let late = fixture.batch(12);
    let late_id = queue_batch(&fixture, &late);
    let late_target = target_client(&fixture.e, &late.target_id);
    let expiry = fixture.client().get_action(&late_id).unwrap().expiry_ledger;
    fixture.set_ledger(expiry + 1);

    assert_eq!(
        fixture.client().try_execute(
            &late_id,
            &late.targets,
            &late.functions,
            &late.args,
            &late.description_hash,
            &executor,
        ),
        failed(TimelockError::Expired)
    );
    assert_eq!(late_target.calls(), 0);
    assert_eq!(
        fixture.client().get_action(&late_id).unwrap().status,
        ActionStatus::Queued
    );

    assert_eq!(fixture.client().mark_expired(&late_id), late_id);
    assert_eq!(
        fixture.client().get_action(&late_id).unwrap().status,
        ActionStatus::Expired
    );
    assert_eq!(
        fixture.client().try_queue(
            &late.targets,
            &late.functions,
            &late.args,
            &late.description_hash,
            &fixture.governor_id,
        ),
        failed(TimelockError::AlreadyQueued)
    );
}

#[test]
fn executed_batch_cannot_be_replayed() {
    let fixture = Fixture::new();
    let batch = fixture.batch(31);
    let target = target_client(&fixture.e, &batch.target_id);
    let action_id = queue_batch(&fixture, &batch);
    let earliest = fixture
        .client()
        .get_action(&action_id)
        .unwrap()
        .earliest_ledger;
    let executor = Address::generate(&fixture.e);

    fixture.set_ledger(earliest);
    fixture.client().execute(
        &action_id,
        &batch.targets,
        &batch.functions,
        &batch.args,
        &batch.description_hash,
        &executor,
    );
    assert_eq!(
        fixture.client().try_execute(
            &action_id,
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &executor,
        ),
        failed(TimelockError::AlreadyExecuted)
    );
    assert_eq!(
        fixture.client().try_queue(
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &fixture.governor_id,
        ),
        failed(TimelockError::AlreadyQueued)
    );
    assert_eq!(target.value(), 31);
    assert_eq!(target.calls(), 1);
    assert_eq!(
        fixture.client().get_action(&action_id).unwrap().status,
        ActionStatus::Executed
    );
}

#[test]
fn queue_rejects_unauthorized_operator() {
    let fixture = Fixture::new();
    let batch = fixture.batch(1);
    let stranger = Address::generate(&fixture.e);

    assert_eq!(
        fixture.client().try_queue(
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &stranger,
        ),
        failed(TimelockError::Unauthorized)
    );
    assert_eq!(
        fixture.client().try_get_action(&fixture.client().action_id(
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
        )),
        Ok(Ok(None))
    );
}

#[test]
fn execute_rejects_mismatched_batch() {
    let fixture = Fixture::new();
    let batch = fixture.batch(5);
    let target = target_client(&fixture.e, &batch.target_id);
    let action_id = queue_batch(&fixture, &batch);
    let earliest = fixture
        .client()
        .get_action(&action_id)
        .unwrap()
        .earliest_ledger;
    let executor = Address::generate(&fixture.e);
    let mismatched_args = vec![&fixture.e, vec![&fixture.e, 999u32.into_val(&fixture.e)]];

    fixture.set_ledger(earliest);
    assert_eq!(
        fixture.client().try_execute(
            &action_id,
            &batch.targets,
            &batch.functions,
            &mismatched_args,
            &batch.description_hash,
            &executor,
        ),
        failed(TimelockError::MismatchedBatch)
    );
    assert_eq!(target.value(), 0);
    assert_eq!(target.calls(), 0);
    assert_eq!(
        fixture.client().get_action(&action_id).unwrap().status,
        ActionStatus::Queued
    );
}

#[test]
fn queue_rejects_proposal_that_is_not_succeeded() {
    let fixture = Fixture::new();
    fixture.governor().set_state(&2);
    let batch = fixture.batch(3);

    assert_eq!(
        fixture.client().try_queue(
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &fixture.governor_id,
        ),
        failed(TimelockError::ProposalNotSucceeded)
    );
}

#[test]
fn queue_rejects_empty_or_uneven_batches() {
    let fixture = Fixture::new();
    let batch = fixture.batch(1);
    let empty: Vec<Address> = vec![&fixture.e];
    let empty_fns: Vec<Symbol> = vec![&fixture.e];
    let empty_args: Vec<Vec<Val>> = vec![&fixture.e];

    assert_eq!(
        fixture.client().try_queue(
            &empty,
            &empty_fns,
            &empty_args,
            &batch.description_hash,
            &fixture.governor_id,
        ),
        failed(TimelockError::InvalidBatch)
    );

    let short_fns = vec![&fixture.e];
    assert_eq!(
        fixture.client().try_queue(
            &batch.targets,
            &short_fns,
            &batch.args,
            &batch.description_hash,
            &fixture.governor_id,
        ),
        failed(TimelockError::InvalidBatch)
    );
}

#[test]
fn delay_arithmetic_rejects_overflow() {
    let e = Env::default();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::checked_window(&e, u32::MAX - 10);
    }));
    assert!(result.is_err());
}

#[test]
fn guardian_cancel_is_terminal_and_stranger_cannot_cancel() {
    let fixture = Fixture::new();
    let batch = fixture.batch(9);
    let target = target_client(&fixture.e, &batch.target_id);
    let action_id = queue_batch(&fixture, &batch);
    let reason = BytesN::from_array(&fixture.e, &[9; 32]);
    let stranger = Address::generate(&fixture.e);
    let executor = Address::generate(&fixture.e);

    assert_eq!(
        fixture.client().try_cancel(&action_id, &reason, &stranger),
        failed(TimelockError::Unauthorized)
    );
    assert_eq!(
        fixture
            .client()
            .cancel(&action_id, &reason, &fixture.guardian),
        action_id
    );

    let record = fixture.client().get_action(&action_id).unwrap();
    assert_eq!(record.status, ActionStatus::Cancelled);
    assert_eq!(record.cancel_reason, Some(reason));
    assert_eq!(record.queued_at, 1_000);

    let earliest = record.earliest_ledger;
    fixture.set_ledger(earliest);
    assert_eq!(
        fixture.client().try_execute(
            &action_id,
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &executor,
        ),
        failed(TimelockError::Cancelled)
    );
    assert_eq!(target.calls(), 0);
    assert_eq!(
        fixture.client().try_queue(
            &batch.targets,
            &batch.functions,
            &batch.args,
            &batch.description_hash,
            &fixture.governor_id,
        ),
        failed(TimelockError::AlreadyQueued)
    );
}
