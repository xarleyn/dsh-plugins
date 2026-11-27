#![cfg(any(test, target_arch = "wasm32"))]

use rapidfuzz::distance::levenshtein;

const LIMIT: usize = 512;

fn distance(left: &[u16], right: &[u16]) -> usize {
    levenshtein::distance(left.iter().copied(), right.iter().copied())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::{LIMIT, distance};
    use std::cell::RefCell;

    // A Wasm instance serves one synchronous caller at a time. No Rust
    // reference is kept across the call that writes this input from JS.
    thread_local! {
        static INPUT: RefCell<[u16; LIMIT * 2]> = const { RefCell::new([0; LIMIT * 2]) };
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn input_ptr() -> *mut u16 {
        INPUT.with(|input| input.borrow_mut().as_mut_ptr())
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn distance_utf16(left_len: usize, right_len: usize) -> i32 {
        if left_len > LIMIT || right_len > LIMIT {
            return -1;
        }
        INPUT.with(|input| {
            let mut input = input.borrow_mut();
            let score = distance(&input[..left_len], &input[LIMIT..LIMIT + right_len]);
            input[..left_len].fill(0);
            input[LIMIT..LIMIT + right_len].fill(0);
            score as i32
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_utf16_units_including_surrogates() {
        assert_eq!(distance(&[], &[0xd800]), 1);
        assert_eq!(distance(&[0xd800, 0xdc00], &[0xd800, 0xdcff]), 1);
        assert_eq!(distance(&[0xffff; LIMIT], &[0; LIMIT]), LIMIT);
    }
}
