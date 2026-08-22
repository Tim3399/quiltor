use std::cmp::Ordering;

/// A host-neutral timeline coordinate.
///
/// `time` is the canonical signed story coordinate. `position` is only a stable
/// tie-break for simultaneous moments.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MomentCoordinate {
    pub id: String,
    pub time: i64,
    pub position: i64,
}

impl MomentCoordinate {
    #[must_use]
    pub fn new(id: impl Into<String>, time: i64, position: i64) -> Self {
        Self {
            id: id.into(),
            time,
            position,
        }
    }
}

/// Canonical comparison shared by every host.
#[must_use]
pub fn compare(left: &MomentCoordinate, right: &MomentCoordinate) -> Ordering {
    left.time
        .cmp(&right.time)
        .then_with(|| left.position.cmp(&right.position))
        .then_with(|| left.id.cmp(&right.id))
}

/// Return canonical order without mutating the caller's collection.
#[must_use]
pub fn canonical_order(moments: &[MomentCoordinate]) -> Vec<MomentCoordinate> {
    let mut ordered = moments.to_vec();
    ordered.sort_by(compare);
    ordered
}

/// Resolve a relative offset while rejecting integer overflow.
///
/// # Errors
///
/// Returns [`TimelineError::Overflow`] when the signed coordinate cannot be
/// represented as an `i64`.
pub fn resolve_relative(base: i64, offset: i64) -> Result<i64, TimelineError> {
    base.checked_add(offset).ok_or(TimelineError::Overflow)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TimelineError {
    Overflow,
}

#[cfg(test)]
mod tests {
    use super::{canonical_order, resolve_relative, MomentCoordinate, TimelineError};

    #[test]
    fn orders_signed_and_simultaneous_moments_deterministically() {
        let fixture = include_str!("../../../contracts/fixtures/timeline-order.tsv");
        let mut rows: Vec<_> = fixture
            .lines()
            .skip(1)
            .map(|line| {
                let mut values = line.split('\t');
                let id = values.next().expect("fixture id");
                let time = values
                    .next()
                    .expect("fixture time")
                    .parse()
                    .expect("integer time");
                let position = values
                    .next()
                    .expect("fixture position")
                    .parse()
                    .expect("integer position");
                let expected_index = values
                    .next()
                    .expect("fixture expected index")
                    .parse::<usize>()
                    .expect("integer expected index");
                (MomentCoordinate::new(id, time, position), expected_index)
            })
            .collect();

        // Feed the implementation a deliberately non-canonical order.
        rows.reverse();
        let expected = {
            let mut expected = rows.clone();
            expected.sort_by_key(|(_, index)| *index);
            expected
                .into_iter()
                .map(|(moment, _)| moment.id)
                .collect::<Vec<_>>()
        };
        let moments = rows
            .into_iter()
            .map(|(moment, _)| moment)
            .collect::<Vec<_>>();

        let ids: Vec<_> = canonical_order(&moments)
            .into_iter()
            .map(|moment| moment.id)
            .collect();

        assert_eq!(ids, expected);
    }

    #[test]
    fn resolves_relative_coordinates_and_rejects_overflow() {
        assert_eq!(resolve_relative(-4, 9), Ok(5));
        assert_eq!(resolve_relative(i64::MAX, 1), Err(TimelineError::Overflow));
    }
}
