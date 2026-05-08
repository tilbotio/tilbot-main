<script lang="ts">
  import { onMount, createEventDispatcher } from "svelte";
  import { Configuration, OpenAIApi } from "openai";

  export let settings: any;
  export let gensettings: any;
  export let variables: any;
  export let is_running: boolean;

  const dispatch = createEventDispatcher();

  let chatgpt_str: string = "";
  let data_str: string = "";
  let loaded_var: string = "";
  let is_loading_csv: boolean = false;
  let openai: any;
  let msgs: Array<any>;
  let var_msgs: Array<any>;
  let is_var_mem: boolean = false;

  onMount(() => {
    window.addEventListener("message", message_received, false);

    // Only works in Electron for now. @TODO: implement for online version of Tilbot.
    if (
      typeof navigator === "object" &&
      typeof navigator.userAgent === "string" &&
      navigator.userAgent.indexOf("Electron") >= 0
    ) {
      window.api.receive("csv-load", (param: any) => {
        if (is_loading_csv) {
          is_loading_csv = false;
          data_str = data_str.replace("[" + loaded_var + "]", param.csv);

          msgs = [
            {
              role: "system",
              content: settings.llm_prompt + "\n" + data_str,
            },
          ];

          // Needs most up-to-date setting for API key (have editor manage it?)
          // Needs settings for prompts from project file -> can be passed from editor
          dispatch("message", {
            event: "run_all",
          });
        }
      });
    }
  });

  async function message_received(event: MessageEvent) {
    if (event.data.msg == "chatgptsim" && is_running) {
      // Bot text from the simulator
      if (event.data.type == "Auto") {
        chatgpt_str += event.data.content + "\n\n";
      } else {
        chatgpt_str += event.data.content;
        console.log(chatgpt_str);

        msgs.push({
          role: "user",
          content: chatgpt_str,
        });

        console.log("=====");
        console.log(msgs);
        console.log("=====");

        const completion = await openai.createChatCompletion({
          model: "gpt-4.1-mini",
          messages: msgs,
          temperature: settings.temperature,
        });

        console.log(completion);
        // @TODO: clean up older messages if we're nearing the token limit.
        // completion.data.usage.total_tokens
        // @TODO: stop in case ChatGPT keeps generating the same text

        let resp = completion.data.choices[0].message.content;

        if (event.data.type == "MC") {
          let mc_options_str = chatgpt_str.substr(
            chatgpt_str.indexOf("{") + 1,
            chatgpt_str.indexOf("}") - chatgpt_str.indexOf("{") - 1
          );
          let mc_options = mc_options_str.split(";");

          for (let i = 0; i < mc_options.length; i++) {
            if (
              resp
                .toLowerCase()
                .includes(
                  mc_options[i]
                    .toLowerCase()
                    .replace("!", "")
                    .replace(".", "")
                    .replace("?", "")
                )
            ) {
              console.log(mc_options[i]);

              msgs.push({
                role: "assistant",
                content: mc_options[i],
              });

              // Deprecated, new turbo version does not need this delay (and won't get it)
              if (gensettings.chatgpt_sim_version == "gpt-4") {
                // Since the GPT-4 API call frequency seems to be very limited, add artificial delay.
                setTimeout(function () {
                  dispatch("message", {
                    event: "send_chatgpt_message",
                    msg: mc_options[i],
                  });
                }, 20000);
              } else {
                dispatch("message", {
                  event: "send_chatgpt_message",
                  msg: mc_options[i],
                });
              }

              break;
            }
          }
        } else {
          if (resp.indexOf("{") !== -1 && resp.indexOf("}") !== -1) {
            resp = resp.replace(
              resp.substr(
                resp.indexOf("{"),
                resp.indexOf("}") - resp.indexOf("{") + 2
              ),
              ""
            );
          }

          msgs.push({
            role: "assistant",
            content: resp,
          });

          if (gensettings.chatgpt_sim_version == "gpt-4") {
            setTimeout(function () {
              dispatch("message", {
                event: "send_chatgpt_message",
                msg: resp,
              });
            }, 20000);
          } else {
            dispatch("message", {
              event: "send_chatgpt_message",
              msg: resp,
            });
          }
        }

        chatgpt_str = "";
      }
    } else if (event.data.msg == "variation") {
      if (
        event.data.memory === undefined ||
        !event.data.memory ||
        var_msgs === undefined ||
        var_msgs.length == 0
      ) {
        var_msgs = [
          {
            role: "system",
            content: event.data.prompt,
          },
        ];
      } else {
        var_msgs[0] = {
          role: "system",
          content: event.data.prompt,
        };
      }

      var_msgs.push({
        role: "user",
        content: event.data.content,
      });

      console.log(var_msgs);

      let resp = "";

      // Check if ChatGPT or another LLM that is triggered via API
      if (gensettings.llm_setting == "chatgpt") {
        const configuration = new Configuration({
          apiKey: gensettings.chatgpt_api_key,
        });

        let openai = new OpenAIApi(configuration);

        const completion = await openai.createChatCompletion({
          //model: "gpt-3.5-turbo",
          model: "gpt-4.1-mini",
          messages: var_msgs,
          temperature: settings.temperature,
        });

        console.log(completion);

        if (completion.data.usage.total_tokens >= 3500) {
          var_msgs.splice(1, 2);
        }

        resp = completion.data.choices[0].message.content;
      } else {
        let url = gensettings.llm_api_address;
        if (gensettings.llm_api_address.indexOf("http") == -1) {
          url = "http://" + url;
        }
        let r = await fetch(
          url + "/get-response?q=" + JSON.stringify({ messages: var_msgs }),
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        resp = await r.json();
        resp = resp.response;
      }

      if (event.data.memory !== undefined && event.data.memory) {
        var_msgs.push({
          role: "assistant",
          content: resp,
        });
      }

      dispatch("message", {
        event: "send_chatgpt_variation",
        msg: resp,
      });
    } else if (event.data.msg == "reset_var_mem") {
      var_msgs = [];
    }
  }

  function stop_chatgpt() {
    is_running = false;
  }

  function run_chatgpt() {
    data_str = settings.llm_prompt_data;

    const configuration = new Configuration({
      apiKey: gensettings.chatgpt_api_key,
    });

    openai = new OpenAIApi(configuration);

    // Fill any data if needed
    // For now we assume at most only one dataset is used
    let regExp = /\[([^\]]+)\]/g;
    let matches = regExp.exec(data_str);

    if (matches !== null) {
      loaded_var = matches[1];

      for (const [key, value] of Object.entries(variables)) {
        if (value.name == loaded_var) {
          is_loading_csv = true;
          window.api.send("get-csv", value.csvfile);
          break;
        }
      }
    } else {
      msgs = [
        {
          role: "system",
          content: settings.llm_prompt + "\n" + data_str,
        },
      ];

      // Needs most up-to-date setting for API key (have editor manage it?)
      // Needs settings for prompts from project file -> can be passed from editor
      dispatch("message", {
        event: "run_all",
      });
    }
  }
</script>

{#if !is_running}
  <button
    class="btn btn-circle bg-[#FFC500] hover:bg-[#ECB600] border-[#FFC500] hover:border-[#ECB600] ml-4"
    on:click={run_chatgpt}
  >
    <svg
      class="w-6 h-6"
      viewBox="0 0 2406 2406"
      version="1.1"
      stroke-width="1.5"
      stroke="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      xmlns:xlink="http://www.w3.org/1999/xlink"
      xml:space="preserve"
    >
      <path
        d="M1107.3,299.1C909.3,299.1 733.4,426.4 672.1,614.4C544.8,640.6 434.9,720.2 370.5,833C271.2,1004.4 293.9,1219.9 426.9,1366.8C385.8,1489.9 399.9,1624.5 465.5,1736C564.2,1908 762.8,1996.2 957.1,1955.2C1043.2,2052.2 1166.9,2107.5 1296.7,2107C1494.7,2107 1670.6,1979.7 1732,1791.7C1859.5,1765.4 1969.2,1685.8 2033,1573.2C2132.9,1401.8 2110.2,1186.3 1977.2,1039.3L1977.2,1038.7C2018.3,915.6 2004.2,780.9 1938.6,668.9C1839.9,497.5 1641.3,409.3 1447.6,450.3C1361,353.5 1237.1,298.5 1107.3,299.1ZM1107.3,416.6L1106.7,417.2C1186.4,417.2 1263,444.7 1324.3,495.6C1321.8,496.8 1316.9,499.9 1313.3,501.7L952.8,709.3C934.4,719.7 923.4,739.3 923.4,760.7L923.4,1248L768.3,1158.6L768.3,755.8C768.2,568.7 919.9,416.9 1107.3,416.6ZM1541.5,558.5C1663.1,558.3 1775.5,623 1836.2,728.3C1875.4,796.9 1890.1,877.1 1876.6,954.8C1874.1,953 1869.3,950.5 1866.2,948.7L1505.8,740.5C1487.4,730.1 1464.8,730.1 1446.4,740.5L1024,984.2L1024,805.4L1372.7,604C1424,574.3 1482.2,558.6 1541.5,558.5ZM650,743.5L650,1171.4C650,1192.8 661,1211.8 679.4,1222.8L1101.1,1465.8L945.4,1555.8L597.2,1355C435.2,1261.2 379.8,1054.1 473.4,892.2C513.1,823.6 575.5,771 650,743.5ZM1457.9,849.5L1806.7,1050.3C1969.2,1144 2024.3,1350.9 1930.5,1513.1L1931.1,1513.7C1891.3,1582.3 1828.7,1634.9 1754.6,1661.9L1754.6,1233.9C1754.6,1212.5 1743.6,1192.9 1725.2,1182.5L1302.9,938.8L1457.9,849.5ZM1201.7,997L1379.5,1099.8L1379.5,1304.9L1201.7,1407.7L1023.9,1304.9L1023.9,1099.8L1201.7,997ZM1481.2,1158.6L1636.3,1248L1636.3,1650.2C1636.3,1837.5 1484.3,1989.4 1297.3,1989.4L1297.3,1988.8C1218.2,1988.8 1141,1961.2 1080.3,1910.4C1082.8,1909.2 1088.3,1906.1 1091.3,1904.3L1451.7,1696.8C1470.1,1686.4 1481.7,1666.8 1481.1,1645.4L1481.2,1158.6ZM1380,1421.9L1380,1600.7L1031.2,1801.5C868.7,1894.6 661.6,1839.5 567.8,1677.8L568.4,1677.8C528.6,1609.8 514.4,1529 527.9,1451.3C530.4,1453.1 535.3,1455.6 538.3,1457.4L898.7,1665.6C917.1,1676 939.7,1676 958.1,1665.6L1380,1421.9Z"
        style="fill-rule:nonzero;"
      />
    </svg>
  </button>
{:else}
  <button
    class="btn btn-circle bg-[#FFC500] hover:bg-[#ECB600] border-[#FFC500] hover:border-[#ECB600] ml-4"
    on:click={stop_chatgpt}
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="#000000"
      class="w-6 h-6"
    >
      <path
        fill-rule="evenodd"
        d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z"
        clip-rule="evenodd"
      />
    </svg>
  </button>
{/if}
