from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import cast

import sentry_sdk

from sentry.integrations.pagerduty.actions import PagerDutyNotifyServiceForm
from sentry.integrations.pagerduty.client import (
    PAGERDUTY_DEFAULT_SEVERITY,
    PAGERDUTY_SUMMARY_MAX_LENGTH,
    PagerdutySeverity,
    build_pagerduty_event_payload,
)
from sentry.integrations.types import IntegrationProviderSlug
from sentry.models.rule import Rule
from sentry.rules.actions import IntegrationEventAction
from sentry.shared_integrations.exceptions import ApiError
from sentry.utils.strings import truncatechars

logger = logging.getLogger("sentry.integrations.pagerduty")


class PagerDutyNotifyServiceAction(IntegrationEventAction):
    id = "sentry.integrations.pagerduty.notify_action.PagerDutyNotifyServiceAction"
    label = "Send a notification to PagerDuty account {account} and service {service} with {severity} severity"
    prompt = "Send a PagerDuty notification"
    provider = IntegrationProviderSlug.PAGERDUTY.value
    integration_key = "account"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.form_fields = {
            "account": {
                "type": "choice",
                "choices": [(i.id, i.name) for i in self.get_integrations()],
            },
            "service": {"type": "choice", "choices": self.get_services()},
            "severity": {
                "type": "choice",
                "choices": [
                    ("default", "default"),
                    ("critical", "critical"),
                    ("warning", "warning"),
                    ("error", "error"),
                    ("info", "info"),
                ],
            },
        }

    def _get_service(self):
        oi = self.get_organization_integration()
        if not oi:
            return None
        for pds in oi.config.get("pagerduty_services", []):
            if str(pds["id"]) == str(self.get_option("service")):
                return pds
        return None

    def after(self, event, notification_uuid: str | None = None):
        integration = self.get_integration()
        log_context = {
            "organization_id": self.project.organization_id,
            "integration_id": self.get_option("account"),
            "service": self.get_option("service"),
        }
        if not integration:
            # integration removed but rule still exists
            logger.info("pagerduty.org_integration_missing", extra=log_context)
            return

        service = self._get_service()
        if not service:
            logger.info("pagerduty.service_missing", extra=log_context)
            return

        severity = cast(
            PagerdutySeverity, self.get_option("severity", default=PAGERDUTY_DEFAULT_SEVERITY)
        )

        def send_notification(event, futures):
            installation = integration.get_installation(self.project.organization_id)
            try:
                client = installation.get_keyring_client(self.get_option("service"))
            except Exception as e:
                sentry_sdk.capture_exception(e)
                return

            data = build_pagerduty_event_payload(
                routing_key=client.integration_key,
                event=event,
                notification_uuid=notification_uuid,
                severity=severity,
            )

            rules: list[Rule] = [f.rule for f in futures]
            rule = rules[0] if rules else None

            if rule and rule.label:
                data["payload"]["summary"] = truncatechars(
                    f"[{rule.label}]: {data['payload']['summary']}", PAGERDUTY_SUMMARY_MAX_LENGTH
                )

            try:
                resp = client.send_trigger(data=data)
            except ApiError as e:
                self.logger.info(
                    "rule.fail.pagerduty_trigger",
                    extra={
                        "error": str(e),
                        "service_name": service["service_name"],
                        "service_id": service["id"],
                        "project_id": event.project_id,
                        "event_id": event.event_id,
                    },
                )
                raise

            self.record_notification_sent(event, str(service["id"]), rule, notification_uuid)

            # TODO(meredith): Maybe have a generic success log statements for
            # first-party integrations similar to plugin `notification.dispatched`
            self.logger.info(
                "rule.success.pagerduty_trigger",
                extra={
                    "status_code": resp.status_code,
                    "project_id": event.project_id,
                    "event_id": event.event_id,
                    "service_name": service["service_name"],
                    "service_id": service["id"],
                },
            )

        key = f"pagerduty:{integration.id}:{service['id']}:{severity}"
        yield self.future(send_notification, key=key)

    def get_services(self) -> Sequence[tuple[int, str]]:
        from sentry.integrations.services.integration import integration_service

        organization_integrations = integration_service.get_organization_integrations(
            providers=[self.provider], organization_id=self.project.organization_id
        )
        return [
            (v["id"], v["service_name"])
            for oi in organization_integrations
            for v in oi.config.get("pagerduty_services", [])
        ]

    def render_label(self):
        s = self._get_service()
        if s:
            service_name = s["service_name"]
        else:
            service_name = "[removed]"

        severity = self.get_option("severity", default=PAGERDUTY_DEFAULT_SEVERITY)

        return self.label.format(
            account=self.get_integration_name(),
            service=service_name,
            severity=severity,
        )

    def get_form_instance(self) -> PagerDutyNotifyServiceForm:
        return PagerDutyNotifyServiceForm(
            self.data,
            integrations=self.get_integrations(),
            services=self.get_services(),
        )
