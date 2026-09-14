// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.27;

import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";

/// @dev Frozen V1 static-word encodings. Callers validate scalar/network bounds.
library PortalMessages {
    function ready(uint256 chainId, address portal, bytes32 board, uint256 version, bytes32 configHash)
        internal pure returns (bytes32)
    {
        return Hash.sha256ToField(abi.encode(bytes32("AZTEC_BB_READY_V1"), uint256(1), chainId, portal, board, version, configHash));
    }

    function receipt(bool isExit, uint256 chainId, address portal, bytes32 board, uint256 version,
        address depositor, uint64 nonce, uint128 amount) internal pure returns (bytes32)
    {
        return Hash.sha256ToField(abi.encode(isExit ? bytes32("AZTEC_BB_EXIT_V1") : bytes32("AZTEC_BB_CLAIM_V1"),
            uint256(1), chainId, portal, board, version, depositor, nonce, amount));
    }
}
