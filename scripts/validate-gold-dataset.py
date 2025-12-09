#!/usr/bin/env python3
"""
Validation script for tool-search-gold.jsonl dataset.

This script validates the gold dataset for Tool Search Tool evaluation:
- JSON schema validation
- Duplicate ID detection
- Expected tools existence verification
- Test case balance check

Usage:
    python scripts/validate-gold-dataset.py --schema
    python scripts/validate-gold-dataset.py --duplicates
    python scripts/validate-gold-dataset.py --tools
    python scripts/validate-gold-dataset.py --balance
    python scripts/validate-gold-dataset.py --all
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple


class DatasetValidator:
    """Validator for tool-search-gold.jsonl dataset."""

    def __init__(self, dataset_path: str, tools_path: str):
        self.dataset_path = Path(dataset_path)
        self.tools_path = Path(tools_path)
        self.errors: List[str] = []
        self.warnings: List[str] = []

    def load_dataset(self) -> List[Dict[str, Any]]:
        """Load JSONL dataset."""
        if not self.dataset_path.exists():
            self.errors.append(f"Dataset file not found: {self.dataset_path}")
            return []

        test_cases = []
        with open(self.dataset_path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    test_case = json.loads(line)
                    test_case["_line_num"] = line_num
                    test_cases.append(test_case)
                except json.JSONDecodeError as e:
                    self.errors.append(
                        f"Line {line_num}: Invalid JSON - {e}"
                    )
        return test_cases

    def load_tools(self) -> Set[str]:
        """Load tool definitions from mock-tools.json."""
        if not self.tools_path.exists():
            self.errors.append(f"Tools file not found: {self.tools_path}")
            return set()

        try:
            with open(self.tools_path, "r", encoding="utf-8") as f:
                tools_data = json.load(f)
                return {tool["name"] for tool in tools_data.get("tools", [])}
        except json.JSONDecodeError as e:
            self.errors.append(f"Invalid JSON in tools file: {e}")
            return set()

    def validate_schema(self, test_cases: List[Dict[str, Any]]) -> bool:
        """Validate JSON schema for each test case."""
        required_fields = {"id", "query", "tool_count", "expected_tools", "category", "difficulty"}
        valid_difficulties = {"easy", "medium", "hard"}

        for test_case in test_cases:
            line_num = test_case.get("_line_num", "?")

            # Check required fields
            missing_fields = required_fields - set(test_case.keys())
            if missing_fields:
                self.errors.append(
                    f"Line {line_num} (id: {test_case.get('id', 'N/A')}): "
                    f"Missing required fields: {missing_fields}"
                )
                continue

            # Validate field types
            if not isinstance(test_case["id"], str):
                self.errors.append(
                    f"Line {line_num}: 'id' must be a string"
                )

            if not isinstance(test_case["query"], str):
                self.errors.append(
                    f"Line {line_num}: 'query' must be a string"
                )

            if not isinstance(test_case["tool_count"], int):
                self.errors.append(
                    f"Line {line_num}: 'tool_count' must be an integer"
                )

            if not isinstance(test_case["expected_tools"], list):
                self.errors.append(
                    f"Line {line_num}: 'expected_tools' must be an array"
                )
            elif not all(isinstance(tool, str) for tool in test_case["expected_tools"]):
                self.errors.append(
                    f"Line {line_num}: All items in 'expected_tools' must be strings"
                )

            if not isinstance(test_case["category"], str):
                self.errors.append(
                    f"Line {line_num}: 'category' must be a string"
                )

            if test_case.get("difficulty") not in valid_difficulties:
                self.warnings.append(
                    f"Line {line_num}: 'difficulty' should be one of {valid_difficulties}, "
                    f"got '{test_case.get('difficulty')}'"
                )

        return len(self.errors) == 0

    def check_duplicate_ids(self, test_cases: List[Dict[str, Any]]) -> bool:
        """Check for duplicate test case IDs."""
        id_counter = Counter(tc["id"] for tc in test_cases if "id" in tc)
        duplicates = [(id_, count) for id_, count in id_counter.items() if count > 1]

        if duplicates:
            for id_, count in duplicates:
                self.errors.append(
                    f"Duplicate ID '{id_}' appears {count} times"
                )
            return False
        return True

    def verify_expected_tools(
        self, test_cases: List[Dict[str, Any]], available_tools: Set[str]
    ) -> bool:
        """Verify that expected tools exist in tool definitions."""
        for test_case in test_cases:
            line_num = test_case.get("_line_num", "?")
            expected_tools = test_case.get("expected_tools", [])

            for tool_name in expected_tools:
                if tool_name not in available_tools:
                    self.errors.append(
                        f"Line {line_num} (id: {test_case.get('id', 'N/A')}): "
                        f"Expected tool '{tool_name}' not found in tool definitions"
                    )

        return len(self.errors) == 0

    def check_balance(self, test_cases: List[Dict[str, Any]]) -> bool:
        """Check test case balance across tool counts."""
        # Expected: 10個×30件、30個×30件、50個×30件
        expected_distribution = {10: 30, 30: 30, 50: 30}
        actual_distribution = Counter(tc.get("tool_count") for tc in test_cases)

        for tool_count, expected_count in expected_distribution.items():
            actual_count = actual_distribution.get(tool_count, 0)
            if actual_count < expected_count:
                self.warnings.append(
                    f"Tool count {tool_count}: Expected {expected_count} test cases, "
                    f"got {actual_count} (short by {expected_count - actual_count})"
                )
            elif actual_count > expected_count:
                self.warnings.append(
                    f"Tool count {tool_count}: Expected {expected_count} test cases, "
                    f"got {actual_count} (excess of {actual_count - expected_count})"
                )

        # Check category distribution
        category_counts = Counter(tc.get("category") for tc in test_cases)
        print("\nCategory distribution:")
        for category, count in sorted(category_counts.items()):
            print(f"  {category}: {count}")

        # Check difficulty distribution
        difficulty_counts = Counter(tc.get("difficulty") for tc in test_cases)
        print("\nDifficulty distribution:")
        for difficulty, count in sorted(difficulty_counts.items()):
            print(f"  {difficulty}: {count}")

        return len(self.warnings) == 0

    def run_validation(
        self,
        check_schema: bool = False,
        check_duplicates: bool = False,
        check_tools: bool = False,
        check_balance: bool = False,
    ) -> Tuple[bool, bool]:
        """
        Run validation checks.

        Returns:
            Tuple of (errors_found, warnings_found)
        """
        test_cases = self.load_dataset()
        if not test_cases:
            print("❌ Failed to load dataset")
            return True, False

        print(f"✓ Loaded {len(test_cases)} test cases from {self.dataset_path}")

        if check_schema:
            print("\n=== Schema Validation ===")
            self.validate_schema(test_cases)

        if check_duplicates:
            print("\n=== Duplicate ID Check ===")
            self.check_duplicate_ids(test_cases)

        if check_tools:
            print("\n=== Expected Tools Verification ===")
            available_tools = self.load_tools()
            if available_tools:
                print(f"✓ Loaded {len(available_tools)} tool definitions from {self.tools_path}")
                self.verify_expected_tools(test_cases, available_tools)
            else:
                print("❌ Failed to load tool definitions")

        if check_balance:
            print("\n=== Test Case Balance Check ===")
            self.check_balance(test_cases)

        # Print results
        has_errors = len(self.errors) > 0
        has_warnings = len(self.warnings) > 0

        if self.errors:
            print("\n🚫 Errors found:")
            for error in self.errors:
                print(f"  ❌ {error}")

        if self.warnings:
            print("\n⚠️  Warnings:")
            for warning in self.warnings:
                print(f"  ⚠️  {warning}")

        if not has_errors and not has_warnings:
            print("\n✅ All validations passed!")
        elif has_errors:
            print(f"\n❌ Validation failed with {len(self.errors)} error(s)")
        else:
            print(f"\n⚠️  Validation passed with {len(self.warnings)} warning(s)")

        return has_errors, has_warnings


def main():
    parser = argparse.ArgumentParser(
        description="Validate tool-search-gold.jsonl dataset"
    )
    parser.add_argument(
        "--schema",
        action="store_true",
        help="Validate JSON schema"
    )
    parser.add_argument(
        "--duplicates",
        action="store_true",
        help="Check for duplicate IDs"
    )
    parser.add_argument(
        "--tools",
        action="store_true",
        help="Verify expected tools exist"
    )
    parser.add_argument(
        "--balance",
        action="store_true",
        help="Check test case balance"
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all validations"
    )
    parser.add_argument(
        "--dataset",
        default="data/tool-search-gold.jsonl",
        help="Path to dataset file (default: data/tool-search-gold.jsonl)"
    )
    parser.add_argument(
        "--tools-file",
        default="scripts/mock-tools.json",
        help="Path to tools file (default: scripts/mock-tools.json)"
    )

    args = parser.parse_args()

    # If no specific check is specified, show help
    if not any([args.schema, args.duplicates, args.tools, args.balance, args.all]):
        parser.print_help()
        sys.exit(1)

    # If --all is specified, enable all checks
    if args.all:
        check_schema = check_duplicates = check_tools = check_balance = True
    else:
        check_schema = args.schema
        check_duplicates = args.duplicates
        check_tools = args.tools
        check_balance = args.balance

    # Run validation
    validator = DatasetValidator(args.dataset, args.tools_file)
    has_errors, has_warnings = validator.run_validation(
        check_schema=check_schema,
        check_duplicates=check_duplicates,
        check_tools=check_tools,
        check_balance=check_balance,
    )

    # Exit with appropriate code
    if has_errors:
        sys.exit(1)  # Errors should block PR merge
    elif has_warnings:
        sys.exit(0)  # Warnings are informational, allow merge
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
