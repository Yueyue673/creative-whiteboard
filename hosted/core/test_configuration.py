import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from service.configuration import secret_key


class SecretConfigurationTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hosted-secret-fixture-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.path = self.root / "only-fixture.key"
        self.key = "fixture-only-not-an-operator-key-" + "q" * 64
        self.path.write_text(self.key + "\n", encoding="utf-8")

    def test_existing_explicit_environment_key_is_preserved(self):
        self.assertEqual(secret_key({"CREATIVE_BOARD_HOSTED_SECRET": self.key}), self.key)

    def test_regular_absolute_secret_file_is_read_without_an_environment_copy(self):
        environment = {"CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.path)}
        self.assertEqual(secret_key(environment), self.key)
        self.assertNotIn("CREATIVE_BOARD_HOSTED_SECRET", environment)
        self.assertEqual(self.path.read_text(encoding="utf-8"), self.key + "\n")

    def test_ambiguous_sources_are_rejected_before_reading_either(self):
        with patch("service.configuration.os.open", side_effect=AssertionError("No file read")):
            with self.assertRaises(ImproperlyConfigured) as raised:
                secret_key({"CREATIVE_BOARD_HOSTED_SECRET": self.key, "CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.path)})
        self.assertNotIn(self.key, str(raised.exception))
        self.assertNotIn(str(self.path), str(raised.exception))

    def test_missing_relative_directory_or_oversized_files_refuse_generic_errors(self):
        for value in (str(self.root / "missing.key"), "relative.key", str(self.root)):
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured) as raised:
                secret_key({"CREATIVE_BOARD_HOSTED_SECRET_FILE": value})
            self.assertNotIn(value, str(raised.exception))
        self.path.write_bytes(b"q" * 4097)
        with self.assertRaises(ImproperlyConfigured):
            secret_key({"CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.path)})

    def test_empty_short_binary_and_multiline_values_refused_without_echo(self):
        for value in (b"", b"short", b"\xff" * 70, (self.key + "\n" + self.key).encode(), (self.key + "\x00").encode()):
            self.path.write_bytes(value)
            with self.assertRaises(ImproperlyConfigured) as raised:
                secret_key({"CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.path)})
            self.assertNotIn(self.key, str(raised.exception))
        with self.assertRaises(ImproperlyConfigured):
            secret_key({})

    def test_changed_open_file_identity_is_rejected(self):
        original = os.fstat
        other = self.root / "other.key"
        other.write_text(self.key, encoding="utf-8")
        with other.open("rb") as stream:
            foreign = original(stream.fileno())
        with patch("service.configuration.os.fstat", return_value=foreign), self.assertRaises(ImproperlyConfigured):
            secret_key({"CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.path)})

    def test_environment_to_file_keeps_exact_leading_and_trailing_key_spaces(self):
        value = "  " + self.key + " "
        self.path.write_bytes((value + "\r\n").encode("utf-8"))
        self.assertEqual(secret_key({"CREATIVE_BOARD_HOSTED_SECRET_FILE": str(self.path)}),
                         secret_key({"CREATIVE_BOARD_HOSTED_SECRET": value}))
