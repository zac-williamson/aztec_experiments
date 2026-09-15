// Fixed public cross-language vector, independently executed through the actual Noir tree implementation.
use super::{Batch, coupon_leaf, validate_coupon};
use aztec::protocol::{address::AztecAddress, traits::FromField, merkle_tree::root::root_from_sibling_path};

global EXPECTED_LEAF: Field = 0x00ac7f0adc95f548e0addbb16a3042efabe008711bf5cec5cc5466c19a0ca251;
global EXPECTED_ROOT: Field = 0x268d70a718941d04576fe5fb5617e90069cd12a58671299a41de10ecb9bcbf69;
global FORMER_PLAIN_ROOT: Field = 0x17fead7b0914b8562f9642b14dd9b820d1516d604c54efd2834f155c41df1502;

#[test]
fn client_vector_matches_production_leaf_and_noir_merkle_root() {
    let siblings: [Field;10] = [101,102,103,104,105,106,107,108,109,110];
    let sponsor=AztecAddress::from_field(11); let owner=AztecAddress::from_field(12);
    // Index683 takes both left/right branches across all ten levels.
    let leaf=coupon_leaf(1,2,sponsor,3,7,683,owner,13);
    assert_eq(leaf,EXPECTED_LEAF);
    assert_eq(root_from_sibling_path(leaf,683,siblings),EXPECTED_ROOT);
    validate_coupon(Batch {root:EXPECTED_ROOT,window:3,ticket_count:1024},1,2,sponsor,7,683,owner,13,siblings);
    assert(EXPECTED_ROOT!=FORMER_PLAIN_ROOT);
}
#[test(should_fail_with="Sponsor invalid coupon membership")]
fn client_vector_rejects_former_javascript_plain_hash_root() {
    validate_coupon(Batch {root:FORMER_PLAIN_ROOT,window:3,ticket_count:1024},1,2,
        AztecAddress::from_field(11),7,683,AztecAddress::from_field(12),13,
        [101,102,103,104,105,106,107,108,109,110]);
}
