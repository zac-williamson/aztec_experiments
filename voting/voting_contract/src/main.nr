mod test;

use aztec::macros::aztec;

#[aztec]
pub contract VotingOracle {
    use aztec::{
        macros::{
            functions::{external, initializer, view},
            storage::storage,
        },
        protocol::address::AztecAddress,
        state_vars::{Map, PublicMutable},
    };

    // Storage
    #[storage]
    struct Storage<Context> {
        dao_balance: PublicMutable<u128, Context>,

        // Static voter registry (7 voters)
        num_voters: PublicMutable<u32, Context>,
        voter_addresses: Map<u32, PublicMutable<AztecAddress, Context>, Context>,

        // Proposal counter
        current_proposal_id: PublicMutable<u32, Context>,

        // Voting period in blocks
        voting_period: PublicMutable<u32, Context>,

        // Vote tracking - keyed by (voter_index || proposal_id) as a u64
        has_voted: Map<u64, PublicMutable<bool, Context>, Context>,
        yes_votes: Map<u32, PublicMutable<u64, Context>, Context>,
        no_votes: Map<u32, PublicMutable<u64, Context>, Context>,

        // Proposal details
        proposal_destination: Map<u32, PublicMutable<AztecAddress, Context>, Context>,
        proposal_amount: Map<u32, PublicMutable<u128, Context>, Context>,
        proposal_start_block: Map<u32, PublicMutable<u32, Context>, Context>,
        proposal_finalized: Map<u32, PublicMutable<bool, Context>, Context>,
    }

    // ===== VIEWS =====

    #[external("public")]
    #[view]
    fn dao_balance() -> pub u128 {
        self.storage.dao_balance.read()
    }

    #[external("public")]
    #[view]
    fn yes_vote_count(proposal_id: u32) -> pub u64 {
        self.storage.yes_votes.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn no_vote_count(proposal_id: u32) -> pub u64 {
        self.storage.no_votes.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn proposal_destination(proposal_id: u32) -> pub AztecAddress {
        self.storage.proposal_destination.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn proposal_amount(proposal_id: u32) -> pub u128 {
        self.storage.proposal_amount.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn proposal_start_block(proposal_id: u32) -> pub u32 {
        self.storage.proposal_start_block.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn proposal_finalized(proposal_id: u32) -> pub bool {
        self.storage.proposal_finalized.at(proposal_id).read()
    }

    #[external("public")]
    #[view]
    fn current_proposal_id() -> pub u32 {
        self.storage.current_proposal_id.read()
    }

    // ===== VOTING =====

    /// Cast a vote on a proposal.
    /// Voter provides their voter_index (0..6) to prove membership.
    /// Double-vote prevention uses (voter_index || proposal_id) as the vote key.
    #[external("public")]
    fn vote(proposal_id: u32, voter_index: u32, vote_yes: bool) {
        let sender = self.context.maybe_msg_sender().unwrap();

        // Bounds check
        let current = self.storage.current_proposal_id.read();
        assert(proposal_id < current, "Invalid proposal");

        // Verify voter membership
        let num_voters = self.storage.num_voters.read();
        assert(voter_index < num_voters, "Invalid voter index");

        // Verify sender matches voter address
        let registered_addr = self.storage.voter_addresses.at(voter_index).read();
        assert(sender == registered_addr, "Sender is not the registered voter at this index");

        // Double-vote prevention: encode (voter_index || proposal_id) as u64
        let vote_key = ((voter_index as u64) << 32) | (proposal_id as u64);
        let has_voted = self.storage.has_voted.at(vote_key).read();
        assert(!has_voted, "Voter already voted in this proposal");
        self.storage.has_voted.at(vote_key).write(true);

        // Update tally
        let current_yes = self.storage.yes_votes.at(proposal_id).read();
        let current_no = self.storage.no_votes.at(proposal_id).read();

        if vote_yes {
            self.storage.yes_votes.at(proposal_id).write(current_yes + 1);
        } else {
            self.storage.no_votes.at(proposal_id).write(current_no + 1);
        }
    }

    // ===== PROPOSAL CREATION =====

    /// Anyone can create a proposal.
    #[external("public")]
    fn create_proposal(destination: AztecAddress, amount: u128) {
        assert(amount > 0, "Amount must be positive");

        let current_balance = self.storage.dao_balance.read();
        assert(amount <= current_balance, "Insufficient DAO balance");

        let id = self.storage.current_proposal_id.read();

        self.storage.proposal_destination.at(id).write(destination);
        self.storage.proposal_amount.at(id).write(amount);
        self.storage.proposal_start_block.at(id).write(self.context.block_number());
        self.storage.yes_votes.at(id).write(0);
        self.storage.no_votes.at(id).write(0);
        self.storage.proposal_finalized.at(id).write(false);

        self.storage.current_proposal_id.write(id + 1);
    }

    // ===== PROPOSAL FINALIZATION =====

    /// Anyone can finalize a passed proposal after the voting period elapses.
    #[external("public")]
    fn finalize(proposal_id: u32) {
        let current = self.storage.current_proposal_id.read();
        assert(proposal_id < current, "Invalid proposal");

        let finalized = self.storage.proposal_finalized.at(proposal_id).read();
        assert(!finalized, "Proposal already finalized");

        let start_block = self.storage.proposal_start_block.at(proposal_id).read();
        let period = self.storage.voting_period.read();
        let current_block = self.context.block_number();
        assert(start_block + period <= current_block, "Voting period not yet elapsed");

        let yes = self.storage.yes_votes.at(proposal_id).read();
        let no = self.storage.no_votes.at(proposal_id).read();
        let num_voters = self.storage.num_voters.read();
        let threshold = (num_voters / 4) as u64;
        assert(yes > no + threshold, "Proposal did not meet threshold");

        let current_balance = self.storage.dao_balance.read();
        let amount = self.storage.proposal_amount.at(proposal_id).read();
        assert(amount <= current_balance, "Insufficient DAO balance at finalization");

        self.storage.dao_balance.write(current_balance - amount);
        self.storage.proposal_finalized.at(proposal_id).write(true);
    }

    // ===== INITIALIZER =====

    #[external("public")]
    #[initializer]
    fn init(
        initial_balance: u128,
        voter_addresses: [AztecAddress; 7],
        voting_period: u32,
    ) {
        self.storage.dao_balance.write(initial_balance);
        self.storage.num_voters.write(7);
        self.storage.current_proposal_id.write(0);
        self.storage.voting_period.write(voting_period);

        for i in 0..7 {
            self.storage.voter_addresses.at(i).write(voter_addresses[i]);
        }
    }
}
