import type { Transport } from '../transport.js';
import type { Template } from '../models.js';

export interface TemplateInput {
  name?: string;
  subject?: string;
  html?: string;
  text?: string;
}

/** `client.templates` — stored bodies, so copy lives on the platform rather than in your deploy. */
export class Templates {
  constructor(private readonly transport: Transport) {}

  list(limit = 100): Promise<Template[]> {
    return this.transport.get<Template[]>(`v1/templates?limit=${Number(limit)}`);
  }

  /**
   * Creates a template.
   *
   * Placeholders are written `{{name}}` and filled at send time from the `variables` you pass. A
   * placeholder with no matching variable is left as-is rather than blanked, so a missing value
   * shows up in a test message instead of silently sending an empty sentence.
   */
  create(template: TemplateInput & { name: string }): Promise<Template> {
    return this.transport.post<Template>('v1/templates', template);
  }

  /**
   * Updates a template, which bumps its version.
   *
   * The version is why editing is safe: a message already sent stays traceable to the body that
   * produced it, rather than appearing to have said whatever the template says today.
   */
  update(id: string, template: TemplateInput): Promise<Template> {
    return this.transport.put<Template>(`v1/templates/${encodeURIComponent(id)}`, template);
  }

  delete(id: string): Promise<void> {
    return this.transport.delete(`v1/templates/${encodeURIComponent(id)}`);
  }
}
