// Dados da Prime (cartão CNPJ emitido em 10/11/2026, passados pela cliente em 18/11/2026).
// Sem Pix completo (chave, nome e cidade) a tela de pagamento mostra aviso e NÃO gera cobrança.
// Sem WhatsApp, os botões "abrir no WhatsApp" somem com aviso. E-mail é opcional.
export const PRIME = {
  pix: {
    chave: '49450793000130', // CNPJ da Prime. CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória
    nomeRecebedor: 'PRIME LIMPEZA ESPECIALIZ', // razão social cortada no limite do padrão Pix; até 25 caracteres, como aparece no banco
    cidadeRecebedor: 'BELO HORIZONTE', // até 15 caracteres, ex.: BELO HORIZONTE vira BELO HORIZONTE
  },
  whatsapp: '5531972363590', // só números com DDI, ex.: 5531972363590
  email: 'primelimpezaespecializada@gmail.com',
  endereco: 'Rua Paraíba, 550, Sala 800, Savassi, Belo Horizonte/MG, CEP 30130-141',
};
