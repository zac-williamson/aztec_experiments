use aztec::macros::aztec;

// Experiment only: publicly authenticated disposable operator, not private username ownership.
#[aztec]
pub contract AvatarLogProbe {
    use aztec::{
        macros::{events::event, functions::{external, initializer, view}, storage::storage},
        protocol::{address::AztecAddress, hash::poseidon2_hash_with_separator},
        state_vars::{PublicImmutable, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        operator: PublicImmutable<AztecAddress, Context>,
        version: PublicMutable<u32, Context>,
        digest: PublicMutable<Field, Context>,
    }

    #[event]
    struct AvatarPublished {
        schema: u32,
        version: u32,
        width: u16,
        height: u16,
        length: u16,
        digest: Field,
        data: [Field; 265],
        trailer: Field,
    }

    #[external("public")]
    #[initializer]
    fn init() {
        self.storage.operator.initialize(self.msg_sender());
    }

    #[external("public")]
    fn publish(version: u32, width: u16, height: u16, length: u16, data: [Field; 265]) {
        assert(self.msg_sender() == self.storage.operator.read(), "Only probe operator");
        assert(version == self.storage.version.read() + 1, "Wrong avatar version");
        assert((width == 100) & (height == 100), "Expected 100x100 raster");
        assert((length > 0) & (length <= 8192), "Avatar byte limit");
        for i in 0..265 {
            let bytes: [u8; 32] = data[i].to_be_bytes();
            assert(bytes[0] == 0, "Field exceeds 31 bytes");
            for j in 0..31 {
                if i * 31 + j >= length as u32 {
                    assert(bytes[j + 1] == 0, "Noncanonical padding");
                }
            }
        }
        // Hash binds exact canonical byte representation, length and displayed metadata.
        let digest = poseidon2_hash_with_separator(
            [version as Field, width as Field, height as Field, length as Field].concat(data),
            0x41565031,
        );
        self.storage.version.write(version);
        self.storage.digest.write(digest);
        self.emit(AvatarPublished { schema: 1, version, width, height, length, digest, data, trailer: 1 });
    }

    #[external("public")]
    #[view]
    fn current() -> pub (u32, Field) {
        (self.storage.version.read(), self.storage.digest.read())
    }
}
