import {z} from 'zod';
export const publicConfigSchema = z.object({
  app: z.object({
    name: z.string(),
    default_generation: z.string(),
    default_output_dor: z.string(), // 注意这里可能是 default_output_dir 的拼写错误
    timeout_ms: z.number(),
    retry_count: z.number()
  }),
  routing: z.object({
    gen3_prefixes: z.array(z.string()),
    gen2_prefixes: z.array(z.string())
  }),
  environment: z.object({
    gen3: z.object({
      base_url: z.url(), // 增加了网址格式校验，如果不想要可删去 .url()
      env_name: z.string()
    }),
    gen2: z.object({
      base_url: z.url(), // 增加了网址格式校验
      env_name: z.string()
    })
  }),
  confirm: z.object({
    require_for_command: z.boolean(),
    require_for_parameter_write: z.boolean(),
    require_for_ota: z.boolean()
  }),
  defaults: z.object({
    status: z.object({
      page_size: z.number()
    }),
    export: z.object({
      format: z.string()
    }),
    parameter: z.object({
      wait_ms: z.number(),
      read_before_write: z.boolean()
    }),
    ota: z.object({
      preflight_minutes: z.number(),
      min_data_count: z.number(),
      poll_interval_ms: z.number(),
      timeout_ms: z.number()
    })
  })
});
export const localConfigSchema = z.object({
    credentials: z.object({
        gen2: z.object({
            token_env:z.string(),
            username_env:z.string(),
            password_env:z.string()
        }),
        gen3: z.object({
            token_env:z.string(),
            username_env:z.string(),
            password_env:z.string()
        })
    }),
});
