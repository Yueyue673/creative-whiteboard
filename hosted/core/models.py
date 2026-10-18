import uuid

from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.contrib.sessions.base_session import AbstractBaseSession
from django.core.validators import validate_email
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .json_data import DocumentJSONEncoder


def canonical_email(value):
    if not isinstance(value, str):
        raise ValueError("邮箱格式不正确")
    value = value.strip().casefold()
    validate_email(value)
    if len(value) > 254:
        raise ValueError("邮箱过长")
    return value


class AccountManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra_fields):
        account = self.model(email=canonical_email(email), **extra_fields)
        account.set_password(password)
        account.save(using=self._db)
        return account

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("管理员标志不正确")
        return self.create_user(email, password, **extra_fields)


class Account(AbstractUser):
    username = None
    email = models.EmailField(unique=True, max_length=254)
    display_name = models.CharField(max_length=80)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["display_name"]
    objects = AccountManager()

    def save(self, *args, **kwargs):
        self.email = canonical_email(self.email)
        return super().save(*args, **kwargs)


class AccountSession(AbstractBaseSession):
    # The public identifier is never the cookie's bearer credential.
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    account = models.ForeignKey(Account, null=True, on_delete=models.CASCADE, related_name="login_sessions")
    started_at = models.DateTimeField(default=timezone.now, editable=False)
    label = models.CharField(max_length=64, default="浏览器登录")

    @classmethod
    def get_session_store_class(cls):
        from .sessions import SessionStore
        return SessionStore


class Workspace(models.Model):
    class Kind(models.TextChoices):
        PERSONAL = "personal", "私有"
        SHARED = "shared", "共享"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=8, choices=Kind.choices)
    owner = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="owned_workspaces")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner"], condition=Q(kind="personal"), name="one_personal_workspace_per_account"),
            models.CheckConstraint(condition=Q(kind__in=["personal", "shared"]), name="valid_workspace_kind"),
        ]


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "所有者"
        EDITOR = "editor", "可编辑"
        VIEWER = "viewer", "只读"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="memberships")
    account = models.ForeignKey(Account, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=6, choices=Role.choices)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "account"], name="unique_workspace_member"),
            models.UniqueConstraint(fields=["workspace"], condition=Q(role="owner"), name="one_workspace_owner_membership"),
            models.CheckConstraint(condition=Q(role__in=["owner", "editor", "viewer"]), name="valid_membership_role"),
        ]


class Invitation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField(max_length=254)
    role = models.CharField(max_length=6, choices=[(Membership.Role.EDITOR, "可编辑"), (Membership.Role.VIEWER, "只读")])
    token_digest = models.CharField(max_length=64, unique=True, editable=False)
    created_by = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="sent_invitations")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    accepted_by = models.ForeignKey(Account, on_delete=models.PROTECT, null=True, blank=True, related_name="accepted_invitations")

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(role__in=["editor", "viewer"]), name="valid_invitation_role"),
            models.UniqueConstraint(fields=["workspace", "email"], condition=Q(revoked_at__isnull=True, accepted_at__isnull=True), name="one_pending_recipient_invitation"),
        ]


class ThrottleBucket(models.Model):
    # HMAC keys contain neither clear-text email addresses nor IP addresses.
    key = models.CharField(max_length=64, unique=True)
    count = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)


class Initialization(models.Model):
    # Unique insertion serializes simultaneous local bootstrap commands.
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(id=1), name="single_initialization")]


class WorkspaceDocument(models.Model):
    class Kind(models.TextChoices):
        BOARD = "board", "白板"
        FOLDERS = "folders", "白板目录"
        LIBRARY = "library", "资料库目录"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="documents")
    kind = models.CharField(max_length=7, choices=Kind.choices)
    key = models.CharField(max_length=100)
    value = models.JSONField(encoder=DocumentJSONEncoder)
    byte_size = models.PositiveIntegerField()
    revision = models.PositiveBigIntegerField(default=1)
    revision_token = models.UUIDField(default=uuid.uuid4, editable=False)
    updated_by = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="updated_documents")
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    purged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "kind", "key"], name="unique_workspace_document"),
            models.CheckConstraint(condition=Q(kind__in=["board", "folders", "library"]), name="valid_document_kind"),
            models.CheckConstraint(condition=Q(purged_at__isnull=True) | Q(kind="board", deleted_at__isnull=False), name="purged_board_stays_deleted"),
        ]


class DocumentRevision(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(WorkspaceDocument, on_delete=models.CASCADE, related_name="versions")
    revision = models.PositiveBigIntegerField()
    value = models.JSONField(encoder=DocumentJSONEncoder)
    byte_size = models.PositiveIntegerField()
    actor = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="document_revisions")
    created_at = models.DateTimeField(auto_now_add=True)
    deleted = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["document", "revision"], name="unique_document_revision")]


class ConflictDraft(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="conflict_drafts")
    kind = models.CharField(max_length=7, choices=WorkspaceDocument.Kind.choices)
    key = models.CharField(max_length=100)
    actor = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="conflict_drafts")
    value = models.JSONField(encoder=DocumentJSONEncoder)
    byte_size = models.PositiveIntegerField()
    base_etag = models.CharField(max_length=80)
    current_etag = models.CharField(max_length=80)
    fingerprint = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["workspace", "actor", "fingerprint"], name="unique_actor_conflict_draft"),
            models.CheckConstraint(condition=Q(kind__in=["board", "folders", "library"]), name="valid_conflict_document_kind"),
        ]


class MediaStorageBudget(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    lock_version = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(id=1), name="single_media_storage_budget")]


class MediaAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="media_assets")
    uploaded_by = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="uploaded_assets")
    filename = models.CharField(max_length=255)
    title = models.CharField(max_length=1000)
    folder_id = models.CharField(max_length=100, blank=True)
    mime = models.CharField(max_length=100)
    size = models.PositiveBigIntegerField()
    content_hash = models.CharField(max_length=64)
    archived = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    tags = models.JSONField(default=list, encoder=DocumentJSONEncoder)
    byte_size = models.PositiveIntegerField()
    revision_token = models.UUIDField(default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class UploadReservation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="uploads")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="uploads")
    size = models.PositiveBigIntegerField()
    filename = models.CharField(max_length=255)
    folder_id = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class NativeFolderTrash(models.Model):
    """A retained original folder hierarchy and exact deleted-board versions."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="folder_trash")
    title = models.CharField(max_length=1000)
    folders = models.JSONField(encoder=DocumentJSONEncoder)
    boards = models.JSONField(encoder=DocumentJSONEncoder)
    byte_size = models.PositiveIntegerField()
    created_by = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="deleted_folders")
    created_at = models.DateTimeField(auto_now_add=True)


class ResearchRecord(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='research_records')
    kind = models.CharField(max_length=9)
    key = models.CharField(max_length=100)
    value = models.JSONField(encoder=DocumentJSONEncoder)
    summary = models.JSONField(encoder=DocumentJSONEncoder)
    byte_size = models.PositiveIntegerField()
    created_by = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='research_records')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['workspace', 'kind', 'key'], name='unique_workspace_research_record'),
            models.CheckConstraint(condition=Q(kind__in=['task', 'reference', 'legacy']), name='valid_research_record_kind'),
        ]
