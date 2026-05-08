const { Configuration, OpenAIApi } = require("openai");

class ChatGPT {
    static openai;

    static init(api_key, temperature) {

        let configuration = new Configuration({
            apiKey: api_key
        });        
        
        this.temperature = temperature;
        
        ChatGPT.openai = new OpenAIApi(configuration);
    }

    static async get_variation(content, prompt, is_mem = false, mem = undefined) {
        let var_msgs = mem;

        if (is_mem) {
            if (var_msgs === undefined || var_msgs.length == 0) {
                var_msgs = [{
                    role: "system",
                    content: prompt
                }];                
            }
            else {
                var_msgs[0] = {
                    role: "system",
                    content: prompt
                };    
            }
        }
        else {
            var_msgs = [{
                role: "system",
                content: prompt
            }];             
        }
        
        var_msgs.push({
            role: "user",
            content: content
        });
        
        console.log(var_msgs);
       
        const completion = await ChatGPT.openai.createChatCompletion({
                //model: "gpt-3.5-turbo",
                model: "gpt-4.1-mini",
                messages: var_msgs,
                temperature: this.temperature
        });
        
        console.log(completion);

        console.log(completion.data.usage.total_tokens);

        if (completion.data.usage.total_tokens >= 3500) {
            var_msgs.splice(1, 2);
        }        

        let resp = completion.data.choices[0].message.content;

        if (is_mem) {
            var_msgs.push({
                role: "assistant",
                content: resp
            });
        }
        
        return [var_msgs, resp];        
    }
}

module.exports = ChatGPT;