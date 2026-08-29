"""Shared enum types used across ORM models."""

import enum


class SplitType(enum.StrEnum):
    """How an expense's amount is divided among participants. See docs/SPEC.md §6."""

    EQUAL = "EQUAL"
    EXACT = "EXACT"
    PERCENTAGE = "PERCENTAGE"
    SHARES = "SHARES"


class MembershipStatus(enum.StrEnum):
    """Whether a group_members row is a real membership or an unaccepted invite
    (docs/SPEC.md §7.1). A PENDING row is created by POST /groups/{id}/members
    and grants nothing — the invitee must POST .../members/me/accept to become
    ACTIVE. Everywhere "member" matters (group-scoped auth §8.5, balances §4,
    expense participants §8.6) only ACTIVE rows count; a PENDING member is
    indistinguishable from a stranger.
    """

    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
