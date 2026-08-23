"""Shared enum types used across ORM models."""

import enum


class SplitType(enum.StrEnum):
    """How an expense's amount is divided among participants. See docs/SPEC.md §6."""

    EQUAL = "EQUAL"
    EXACT = "EXACT"
    PERCENTAGE = "PERCENTAGE"
    SHARES = "SHARES"
