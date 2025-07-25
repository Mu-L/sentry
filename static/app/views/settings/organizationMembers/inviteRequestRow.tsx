import {Fragment} from 'react';
import styled from '@emotion/styled';

import Confirm from 'sentry/components/confirm';
import {Tag} from 'sentry/components/core/badge/tag';
import {Button} from 'sentry/components/core/button';
import {Tooltip} from 'sentry/components/core/tooltip';
import type {InviteModalRenderFunc} from 'sentry/components/modals/memberInviteModalCustomization';
import {InviteModalHook} from 'sentry/components/modals/memberInviteModalCustomization';
import PanelItem from 'sentry/components/panels/panelItem';
import RoleSelectControl from 'sentry/components/roleSelectControl';
import TeamSelector from 'sentry/components/teamSelector';
import {IconCheckmark, IconClose} from 'sentry/icons';
import {t, tct} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {Member, Organization, OrgRole} from 'sentry/types/organization';

type Props = {
  allRoles: OrgRole[];
  inviteRequest: Member;
  inviteRequestBusy: Record<string, boolean>;
  onApprove: (inviteRequest: Member) => void;
  onDeny: (inviteRequest: Member) => void;
  onUpdate: (data: Partial<Member>) => void;
  organization: Organization;
};

function InviteRequestRow({
  inviteRequest,
  inviteRequestBusy,
  organization,
  onApprove,
  onDeny,
  onUpdate,
  allRoles,
}: Props) {
  const role = allRoles.find(r => r.id === inviteRequest.role);
  const roleDisallowed = !role?.isAllowed;
  const {access} = organization;
  const canApprove = access.includes('member:admin');

  const hookRenderer: InviteModalRenderFunc = ({sendInvites, canSend, headerInfo}) => (
    <StyledPanelItem>
      <div>
        <h5 style={{marginBottom: space(0.5)}}>
          <UserName>{inviteRequest.email}</UserName>
        </h5>
        {inviteRequest.inviteStatus === 'requested_to_be_invited' ? (
          inviteRequest.inviterName && (
            <Description>
              <Tooltip
                title={t(
                  'An existing member has asked to invite this user to your organization'
                )}
              >
                {tct('Requested by [inviterName]', {
                  inviterName: inviteRequest.inviterName,
                })}
              </Tooltip>
            </Description>
          )
        ) : (
          <Tag title={t('This user has asked to join your organization.')}>
            {t('Join request')}
          </Tag>
        )}
      </div>

      {canApprove ? (
        <StyledRoleSelectControl
          name="role"
          disableUnallowed
          onChange={r => onUpdate({role: r.value})}
          value={inviteRequest.role}
          roles={allRoles}
          aria-label={t('Role: %s', role?.name)}
        />
      ) : (
        <div>{inviteRequest.roleName}</div>
      )}
      {canApprove ? (
        <TeamSelectControl
          name="teams"
          placeholder={t('None')}
          onChange={(teams: any) =>
            onUpdate({teams: (teams || []).map((team: any) => team.value)})
          }
          value={inviteRequest.teams}
          clearable
          multiple
        />
      ) : (
        <div>{inviteRequest.teams.join(', ')}</div>
      )}

      <ButtonGroup>
        <Button
          size="sm"
          busy={inviteRequestBusy[inviteRequest.id]}
          onClick={() => onDeny(inviteRequest)}
          icon={<IconClose />}
          disabled={!canApprove}
          title={
            canApprove
              ? undefined
              : t('This request needs to be reviewed by a privileged user')
          }
        >
          {t('Deny')}
        </Button>
        <Confirm
          onConfirm={sendInvites}
          disableConfirmButton={!canSend}
          disabled={!canApprove || roleDisallowed}
          message={
            <Fragment>
              {tct('Are you sure you want to invite [email] to your organization?', {
                email: inviteRequest.email,
              })}
              {headerInfo}
            </Fragment>
          }
        >
          <Button
            priority="primary"
            size="sm"
            busy={inviteRequestBusy[inviteRequest.id]}
            title={
              canApprove
                ? roleDisallowed
                  ? t(
                      `You do not have permission to approve a user of this role.
                      Select a different role to approve this user.`
                    )
                  : undefined
                : t('This request needs to be reviewed by a privileged user')
            }
            icon={<IconCheckmark />}
          >
            {t('Approve')}
          </Button>
        </Confirm>
      </ButtonGroup>
    </StyledPanelItem>
  );

  return (
    <InviteModalHook
      willInvite
      organization={organization}
      onSendInvites={() => onApprove(inviteRequest)}
    >
      {hookRenderer}
    </InviteModalHook>
  );
}

const StyledPanelItem = styled(PanelItem)`
  display: grid;
  grid-template-columns: minmax(150px, auto) minmax(100px, 140px) 220px max-content;
  gap: ${space(2)};
  align-items: center;
`;

const UserName = styled('div')`
  font-size: ${p => p.theme.fontSize.lg};
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Description = styled('div')`
  display: block;
  color: ${p => p.theme.subText};
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StyledRoleSelectControl = styled(RoleSelectControl)`
  max-width: 140px;
`;

const TeamSelectControl = styled(TeamSelector)`
  max-width: 220px;
  .Select-value-label {
    max-width: 150px;
    word-break: break-all;
  }
`;

const ButtonGroup = styled('div')`
  display: inline-grid;
  grid-template-columns: repeat(2, max-content);
  gap: ${space(1)};
`;

export default InviteRequestRow;
