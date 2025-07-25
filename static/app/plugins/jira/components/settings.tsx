import styled from '@emotion/styled';
import isEqual from 'lodash/isEqual';

import {Alert} from 'sentry/components/core/alert';
import {Button} from 'sentry/components/core/button';
import Form from 'sentry/components/deprecatedforms/form';
import FormState from 'sentry/components/forms/state';
import LoadingIndicator from 'sentry/components/loadingIndicator';
import {t} from 'sentry/locale';
import DefaultSettings from 'sentry/plugins/components/settings';

type Field = Parameters<typeof DefaultSettings.prototype.renderField>[0]['config'];

type FieldWithValues = Field & {defaultValue?: any; value?: any};

type ApiData = {config: FieldWithValues[]; default_project?: string};

type Props = DefaultSettings['props'];

type State = DefaultSettings['state'] & {
  page: number;
  editing?: boolean;
};

const PAGE_FIELD_LIST = {
  0: ['instance_url', 'username', 'password'],
  1: ['default_project'],
  2: ['ignored_fields', 'default_priority', 'default_issue_type', 'auto_create'],
};

class Settings extends DefaultSettings<Props, State> {
  constructor(props: Props) {
    super(props);

    Object.assign(this.state, {
      page: 0,
    });
  }

  isConfigured() {
    return !!this.state.formData?.default_project;
  }

  isLastPage = () => {
    return this.state.page === 2;
  };

  fetchData() {
    // This is mostly copy paste of parent class
    // except for setting edit state
    this.api.request(this.getPluginEndpoint(), {
      success: (data: ApiData) => {
        const formData: Record<string, any> = {};
        const initialData = {};
        data.config.forEach(field => {
          formData[field.name] = field.value || field.defaultValue;
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          initialData[field.name] = field.value;
        });
        this.setState(
          {
            fieldList: data.config,
            formData,
            initialData,
            // start off in edit mode if there isn't a project set
            editing: !formData?.default_project,
            // call this here to prevent FormState.READY from being
            // set before fieldList is
          },
          this.onLoadSuccess
        );
      },
      error: this.onLoadError,
    });
  }

  startEditing = () => {
    this.setState({editing: true});
  };

  onSubmit() {
    if (isEqual(this.state.initialData, this.state.formData)) {
      if (this.isLastPage()) {
        this.setState({editing: false, page: 0});
      } else {
        this.setState({page: this.state.page + 1});
      }
      this.onSaveSuccess(this.onSaveComplete);
      return;
    }
    const body = Object.assign({}, this.state.formData);
    // if the project has changed, it's likely these values aren't valid anymore
    if (body.default_project !== this.state.initialData?.default_project) {
      body.default_issue_type = null;
      body.default_priority = null;
    }
    this.api.request(this.getPluginEndpoint(), {
      data: body,
      method: 'PUT',
      success: this.onSaveSuccess.bind(this, (data: ApiData) => {
        const formData = {};
        const initialData = {};
        data.config.forEach(field => {
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          formData[field.name] = field.value || field.defaultValue;
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          initialData[field.name] = field.value;
        });
        const state = {
          formData,
          initialData,
          errors: {},
          fieldList: data.config,
          page: this.state.page,
          editing: this.state.editing,
        };
        if (this.isLastPage()) {
          state.editing = false;
          state.page = 0;
        } else {
          state.page = this.state.page + 1;
        }
        this.setState(state);
      }),
      error: this.onSaveError.bind(this, (error: any) => {
        this.setState({
          errors: error.responseJSON?.errors || {},
        });
      }),
      complete: this.onSaveComplete,
    });
  }

  back = (ev: React.MouseEvent) => {
    ev.preventDefault();
    if (this.state.state === FormState.SAVING) {
      return;
    }
    this.setState({
      page: this.state.page - 1,
    });
  };

  render() {
    if (this.state.state === FormState.LOADING) {
      return <LoadingIndicator />;
    }

    if (this.state.state === FormState.ERROR && !this.state.fieldList) {
      return (
        <Alert.Container>
          <Alert type="error" showIcon={false}>
            An unknown error occurred. Need help with this?{' '}
            <a href="https://sentry.io/support/">Contact support</a>
          </Alert>
        </Alert.Container>
      );
    }

    const isSaving = this.state.state === FormState.SAVING;

    let fields: Field[] | undefined;
    let onSubmit: () => void;
    let submitLabel: string;
    if (this.state.editing) {
      fields = this.state.fieldList?.filter(f =>
        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        PAGE_FIELD_LIST[this.state.page].includes(f.name)
      );
      onSubmit = this.onSubmit;
      submitLabel = this.isLastPage() ? 'Finish' : 'Save and Continue';
    } else {
      fields = this.state.fieldList?.map(f => ({...f, readonly: true}));
      onSubmit = this.startEditing;
      submitLabel = 'Edit';
    }
    return (
      <Form
        onSubmit={onSubmit}
        submitDisabled={isSaving}
        submitLabel={submitLabel}
        extraButton={
          this.state.page === 0 ? null : (
            <FloatLeftButton onClick={this.back} busy={isSaving}>
              {t('Back')}
            </FloatLeftButton>
          )
        }
      >
        {this.state.errors.__all__ && (
          <Alert type="error" showIcon={false}>
            <ul>
              <li>{this.state.errors.__all__}</li>
            </ul>
          </Alert>
        )}
        {fields?.map(f =>
          this.renderField({
            config: f,
            formData: this.state.formData,
            formErrors: this.state.errors,
            onChange: this.changeField.bind(this, f.name),
          })
        )}
      </Form>
    );
  }
}

const FloatLeftButton = styled(Button)`
  float: left;
`;

export default Settings;
