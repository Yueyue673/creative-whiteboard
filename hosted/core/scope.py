from dataclasses import dataclass

from django.conf import settings

from .models import Membership, Workspace


def valid_membership(member):
    actual_owner = member.workspace.owner_id == member.account_id
    return (
        (member.role == Membership.Role.OWNER) == actual_owner
        and (member.workspace.kind == Workspace.Kind.SHARED or actual_owner)
    )


@dataclass(frozen=True)
class WorkspaceScope:
    """Bound to this request's URL; never a process or session 'current workspace'."""
    workspace: Workspace
    role: str

    @property
    def can_edit(self):
        return self.role in (Membership.Role.OWNER, Membership.Role.EDITOR)

    @property
    def is_owner(self):
        return self.role == Membership.Role.OWNER

    def storage_root(self):
        base = settings.HOSTED_DATA_ROOT.resolve()
        target = base / "workspaces" / self.workspace.id.hex
        if target.resolve() != target:
            raise ValueError("工作区存储路径超出范围")
        return target
