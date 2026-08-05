# Spec: concurrency-rule-evaluation

## ADDED Requirements

### Requirement: A single shared definition of whether an overlap is a conflict

The system SHALL expose one pure function that decides whether two events
sharing a room and an overlapping time window constitute a conflict. It SHALL
take the two sides and a resolved category map, SHALL perform no I/O, and SHALL
return a boolean.

Every caller that needs this decision — the publish-time conflict check and the
conflict report — SHALL use this function. No caller SHALL carry its own copy
of the rules.

#### Scenario: Both callers agree
- **WHEN** the same pair of events is evaluated by the publish-time check and
  by the conflict report
- **THEN** both reach the same verdict, because both call the same function

#### Scenario: No I/O
- **WHEN** the function is called
- **THEN** it performs no database access and depends only on its arguments

### Requirement: Category grants are bilateral

The function SHALL treat a category allowance as sufficient in either
direction. If any category of side A lists any category of side B in its
`allowedConcurrentCategories`, the pair SHALL NOT be a conflict; the same
SHALL hold with the sides reversed.

The two directional checks SHALL be evaluated in a fixed order — A-grants-B
first, then B-grants-A — preserving the short-circuit order of the behavior
being extracted.

#### Scenario: A's category permits B's
- **WHEN** a category of side A lists a category of side B as allowed concurrent
- **THEN** the pair is not a conflict

#### Scenario: B's category permits A's
- **WHEN** a category of side B lists a category of side A as allowed concurrent
- **THEN** the pair is not a conflict

#### Scenario: Neither category permits the other
- **WHEN** no category on either side lists any category of the other
- **THEN** the category rules do not resolve the pair and evaluation continues
  to the per-event rules

#### Scenario: A category name with no matching document
- **WHEN** a side carries a category name that resolves to no document in the
  category map
- **THEN** that name contributes no grant and does not cause an error

### Requirement: Per-event concurrency flags are the fallback

When the category rules do not resolve the pair, the function SHALL fall back
to the per-event `isAllowedConcurrent` flag and its
`allowedConcurrentCategories` restriction list.

A side that allows concurrency with an empty restriction list SHALL permit any
counterpart. A side that allows concurrency with a non-empty restriction list
SHALL permit only counterparts carrying one of the listed categories. When
neither side allows concurrency, the pair SHALL be a conflict.

An absent flag SHALL be treated as not allowing concurrency.

#### Scenario: Neither side allows concurrency
- **WHEN** both sides have `isAllowedConcurrent` false or absent
- **THEN** the pair is a conflict

#### Scenario: Unrestricted concurrency
- **WHEN** one side allows concurrency and lists no restricting categories
- **THEN** the pair is not a conflict

#### Scenario: Restricted concurrency, counterpart matches
- **WHEN** one side allows concurrency restricted to a set of categories and
  the counterpart carries one of them
- **THEN** the pair is not a conflict

#### Scenario: Restricted concurrency, counterpart does not match
- **WHEN** one side allows concurrency restricted to a set of categories and
  the counterpart carries none of them
- **THEN** the pair is a conflict

#### Scenario: Missing flag is not permissive
- **WHEN** a side has no `isAllowedConcurrent` field at all
- **THEN** it is treated as not allowing concurrency

### Requirement: Extraction preserves existing publish-time behavior

Refactoring the publish-time check to call the shared function SHALL NOT change
any observable behavior of that check: the 409 contract, the `hardConflicts` /
`softConflicts` / `allConflicts` shapes, conflict tiers, and which pairs are
reported SHALL be identical before and after.

Because the test suite on main is red, this invariance SHALL be established by
comparing pass and fail counts of the affected suites before and after the
change, not by assuming a green run.

#### Scenario: Conflict suites unchanged
- **WHEN** the conflict suites are run before and after the extraction
- **THEN** the pass and fail counts are identical

#### Scenario: Response shapes unchanged
- **WHEN** the publish-time check reports a conflict after the extraction
- **THEN** the response carries the same fields and structure it carried before
